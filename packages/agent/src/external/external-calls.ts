// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * One external call in its run's log (P3-V4): requested under an id derived from the gateway's call key (a
 * repeat finds it and resumes it), completed or failed like the agent's own calls (act.ts), and the outcome a
 * repeat reads back from the log. Waiting for the person is a hold on the feed, never a loop.
 */
import { CancelledError, err, newId, ok, type AsyncResult, type Result, type ToolRunId } from '@taalcut/core';
import { ToolDenied, type ToolResult } from '@taalcut/tools';
import type { AgentFeedEvent } from '../agent-types';
import type { EventPayloads } from '../events';
import { toolExtras } from '../model-turn';
import type { EventInput, RunLog } from '../run-log';
import type { ToolCallState } from '../run-state';
import type { ExternalCallOutcome } from './external-types';

const NO_USAGE = { usd: 0, inputTokens: 0, outputTokens: 0 };

/** The call a key already asked for in this run, if any. */
export function callByKey(log: RunLog, callKey: string): ToolCallState | undefined {
  return Object.values(log.state.toolCalls).find((c) => c.requested.modelToolCallId === callKey);
}

/** Logs tool.requested for a new external call. */
export async function requestCall(
  log: RunLog,
  input: {
    readonly callKey: string;
    readonly sessionId: string;
    readonly name: string;
    readonly args: unknown;
    readonly tool: Parameters<typeof toolExtras>[0] & {
      readonly descriptor: {
        readonly name: string;
        readonly sideEffect: EventPayloads['tool.requested']['sideEffect'];
      };
    };
  },
): AsyncResult<ToolRunId> {
  const toolCallId = newId<'ToolRun'>() as ToolRunId;
  const logged = await log.append([
    'tool.requested',
    {
      toolCallId,
      // No model asked: the session stands in for the model call, the gateway's key for the model's call id.
      modelCallId: `mcp:${input.sessionId}`,
      modelToolCallId: input.callKey,
      tool: input.tool.descriptor.name,
      callName: input.name,
      meta: false,
      input: input.args,
      sideEffect: input.tool.descriptor.sideEffect,
      ...toolExtras(input.tool),
    },
  ]);
  return logged.ok ? ok(toolCallId) : logged;
}

/** tool.completed or tool.failed for a call, and its paid estimate settled (as act.ts does). */
export function outcomeEvents(
  log: RunLog,
  toolCallId: ToolRunId,
  result: Result<ToolResult>,
  durationMs: number,
  idempotencyKey: string | undefined,
): EventInput[] {
  const key = idempotencyKey ? { idempotencyKey } : {};
  const outcome: EventInput = result.ok
    ? [
        'tool.completed',
        {
          toolCallId,
          version: result.value.version,
          inputHash: result.value.inputHash,
          output: result.value.output,
          cached: result.value.cached,
          deduplicated: result.value.deduplicated,
          attempts: result.value.attempts,
          durationMs: result.value.durationMs,
          usage: result.value.usage,
          ...(result.value.approvalId ? { approvalId: result.value.approvalId } : {}),
          ...key,
        },
      ]
    : [
        'tool.failed',
        {
          toolCallId,
          error: result.error,
          attempts: CancelledError.is(result.error) ? 0 : 1,
          durationMs,
          usage: NO_USAGE,
          ...key,
        },
      ];
  const estimate = Object.values(log.state.estimates).find(
    (e) => e.recorded.toolCallId === toolCallId && !e.settled,
  );
  const usage = result.ok ? result.value.usage : NO_USAGE;
  const settled: EventInput[] = estimate
    ? [
        [
          'estimate.settled',
          {
            estimateId: estimate.recorded.estimateId,
            actual: { usd: usage.usd, tokens: usage.inputTokens + usage.outputTokens },
          },
        ],
      ]
    : [];
  return [outcome, ...settled];
}

/** What a call that already ended in the log answers on a repeat. */
export function loggedOutcome(call: ToolCallState): AsyncResult<ExternalCallOutcome> | undefined {
  const outcome = call.outcome;
  if (!outcome) return undefined;
  if (outcome.kind === 'failed') {
    return Promise.resolve(
      ToolDenied.is(outcome.payload.error) ? ok({ kind: 'declined' as const }) : err(outcome.payload.error),
    );
  }
  const done = outcome.payload;
  const result: ToolResult = {
    callId: done.toolCallId,
    tool: call.requested.tool,
    version: done.version ?? '',
    inputHash: done.inputHash ?? '',
    value: done.output.kind === 'inline' ? done.output.value : done.output.ref,
    output: done.output,
    usage: done.usage,
    cached: false,
    deduplicated: true,
    attempts: 0,
    durationMs: done.durationMs,
    ...(done.approvalId ? { approvalId: done.approvalId } : {}),
  };
  return Promise.resolve(ok({ kind: 'done' as const, result }));
}

/** The pending approval that holds a call, if any. */
export function pendingFor(log: RunLog, toolCallId: string): string | undefined {
  return Object.values(log.state.approvals).find(
    (a) => a.status === 'pending' && a.request.toolCallIds.includes(toolCallId),
  )?.request.requestId;
}

/**
 * Waits until the approval is answered (true), the hold ends (false) or the signal aborts (false). Ticks
 * `onTick` while it waits.
 */
export function waitForAnswer(input: {
  readonly log: RunLog;
  readonly requestId: string;
  readonly holdMs: number;
  readonly signal: AbortSignal;
  readonly subscribe: (listener: (event: AgentFeedEvent) => void) => () => void;
  readonly tickMs: number;
  readonly onTick?: () => void;
}): Promise<boolean> {
  const answered = () => input.log.state.approvals[input.requestId]?.status !== 'pending';
  if (answered()) return Promise.resolve(true);
  return new Promise((resolve) => {
    let finished = false;
    const finish = (value: boolean) => {
      if (finished) return;
      finished = true;
      clearTimeout(hold);
      clearInterval(ticks);
      unsubscribe();
      input.signal.removeEventListener('abort', aborted);
      resolve(value);
    };
    const aborted = () => finish(false);
    const unsubscribe = input.subscribe((event) => {
      if (!('seq' in event) || event.runId !== input.log.runId) return;
      if (
        (event.type === 'approval.granted' || event.type === 'approval.denied') &&
        event.payload.requestId === input.requestId
      )
        finish(true);
    });
    const hold = setTimeout(() => finish(answered()), input.holdMs);
    const ticks = setInterval(() => input.onTick?.(), input.tickMs);
    input.signal.addEventListener('abort', aborted, { once: true });
    if (input.signal.aborted) finish(false);
  });
}
