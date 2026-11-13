// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A registry tool called through the external runner, in the session's run, under the agent's own policy: progress
 * (tool progress, and ticks while an approval is held) streams out at most every `progressEveryMs`, then exactly
 * one result. A client that goes away before the result cancels the call; a call held for approval is noted in the
 * ledger, so the client's repeat resumes it.
 */
import {
  CancelledError,
  err,
  newId,
  type McpCallItem,
  type McpSessionId,
  type McpSessionRecord,
  type Result,
} from '@taalcut/core';
import { contentHash } from '../hash';
import type { CallLedger } from './call-ledger';
import type { CallFlowDeps, McpCallInput } from './call-types';
import type { ExternalCallOptions, ExternalCallOutcome, McpOrigin } from './external-runner';
import { createItemChannel, type ItemChannel } from './item-channel';
import { declinedItem, doneItem, errorItem, pendingItem } from './results';

/**
 * The runner's key for this call: the waiting call's when the client repeats one that is waiting for approval
 * (it resumes), else a new one, so a repeat of a finished call runs again rather than answering from the first.
 */
function runKeyFor(
  ledger: Pick<CallLedger, 'waitingRunKey'>,
  sessionId: McpSessionId,
  callKey: string,
): string {
  return ledger.waitingRunKey(sessionId, callKey) ?? contentHash({ callKey, call: newId() });
}

function outcomeItem(outcome: ExternalCallOutcome): Extract<McpCallItem, { type: 'result' }> {
  if (outcome.kind === 'done') return doneItem(outcome.result);
  if (outcome.kind === 'pending') return pendingItem(outcome.approvalId);
  return declinedItem();
}

/** The runner's progress callback: throttled to `progressEveryMs`, clamped and trimmed, and only when wanted. */
function progressInto(
  deps: Pick<CallFlowDeps, 'clock' | 'progressEveryMs'>,
  wanted: boolean,
  channel: ItemChannel<McpCallItem>,
): NonNullable<ExternalCallOptions['onProgress']> {
  let lastProgress = Number.NEGATIVE_INFINITY;
  return (fraction, message) => {
    const now = deps.clock.now();
    if (!wanted || now - lastProgress < deps.progressEveryMs) return;
    lastProgress = now;
    channel.push({
      type: 'progress',
      fraction: fraction === null ? null : Math.min(1, Math.max(0, fraction)),
      ...(message ? { message: message.slice(0, 200) } : {}),
    });
  };
}

/** A call the gateway let through: the live session, the registry tool's name and who the call is from. */
interface ExternalCall {
  readonly record: McpSessionRecord;
  readonly tool: string;
  readonly input: McpCallInput;
  readonly origin: McpOrigin;
}

/** One call through the runner: the ledger's bookkeeping, the progress and the result. */
export async function* runExternalCall(
  deps: CallFlowDeps,
  { record, tool, input, origin }: ExternalCall,
  signal: AbortSignal | undefined,
): AsyncGenerator<McpCallItem, void, undefined> {
  const channel = createItemChannel<McpCallItem>();
  const call = deps.ledger.begin(record.id, signal);
  const runKey = runKeyFor(deps.ledger, record.id, input.callKey);
  const settled: Promise<Result<ExternalCallOutcome>> = deps.runner
    .call(record.runId, tool, input.arguments, {
      callKey: runKey,
      level: record.level,
      origin,
      requester: { kind: 'mcp', sessionId: record.id, name: record.name },
      holdMs: deps.holdMs,
      signal: call.signal,
      onProgress: progressInto(deps, input.wantsProgress, channel),
    })
    .catch((cause: unknown) => err(CancelledError(undefined, { detail: String(cause) })));
  void settled.finally(() => channel.close());

  try {
    yield* channel.drain();
  } finally {
    // The client went away before the result: the call must not go on without anyone to answer.
    if (!channel.closed) call.abort();
    call.end();
  }
  const outcome = await settled;
  if (outcome.ok && outcome.value.kind === 'pending') {
    deps.ledger.pending(record.id, input.callKey, outcome.value.approvalId, runKey);
  } else {
    deps.ledger.settled(record.id, input.callKey);
  }
  yield outcome.ok ? outcomeItem(outcome.value) : errorItem(outcome.error);
}
