// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * One external call (P3-V4): admitted (the run still open, the tool known and within the session's level),
 * then run under the policy. A call the person must approve waits up to `holdMs` and answers pending, or runs
 * again once answered; its outcome is logged like the agent's own calls (a cancelled call stays open, so the
 * same key runs it again and close() ends it).
 */
import {
  CancelledError,
  err,
  ok,
  type AsyncResult,
  type Result,
  type TaalcutError,
  type ToolRunId,
} from '@taalcut/core';
import {
  ToolAwaitingApproval,
  ToolDenied,
  ToolNotFound,
  type ToolExecutor,
  type ToolRegistry,
  type ToolResult,
} from '@taalcut/tools';
import { isTerminal } from '../agent-answer';
import type { ExternalRunHost } from '../agent-types';
import { ExternalLevelTooLow, RunFinished } from '../errors';
import type { RunLog } from '../run-log';
import { outcomeEvents, pendingFor, waitForAnswer } from './external-calls';
import type { ProgressListener } from './external-executor';
import { levelAllows } from './external-policy';
import type { ExternalCallOptions, ExternalCallOutcome } from './external-types';

const WAITING_NOTE = 'Waiting for approval in Taalcut';

type ResolvedTool = NonNullable<ReturnType<ToolRegistry['resolve']>>;

/** The tool a call names, if the run is still open and the session's level covers it. */
export function admitCall(
  log: RunLog,
  tools: Pick<ToolRegistry, 'resolve'>,
  name: string,
  level: ExternalCallOptions['level'],
): Result<ResolvedTool> {
  if (isTerminal(log.state)) return err(RunFinished({ runId: log.runId }));
  const tool = tools.resolve(name);
  if (!tool) return err(ToolNotFound({ tool: name }));
  return levelAllows(level, tool.descriptor)
    ? ok(tool)
    : err(ExternalLevelTooLow({ tool: tool.descriptor.name, level }));
}

export interface ExternalExecution {
  readonly executor: ToolExecutor;
  readonly host: Pick<ExternalRunHost, 'now' | 'subscribe'>;
  readonly progress: Map<string, ProgressListener>;
  readonly idempotencyKeys: ReadonlyMap<string, string>;
  /** How often a held call ticks "still waiting for approval". */
  readonly tickMs: number;
}

export interface ExternalCall {
  readonly log: RunLog;
  readonly toolCallId: ToolRunId;
  readonly name: string;
  readonly input: unknown;
  readonly options: ExternalCallOptions;
  readonly signal: AbortSignal;
}

export async function executeExternalCall(
  ctx: ExternalExecution,
  call: ExternalCall,
): AsyncResult<ExternalCallOutcome> {
  for (;;) {
    const started = ctx.host.now();
    const result = await runTool(ctx, call);
    if (!result.ok && ToolAwaitingApproval.is(result.error)) {
      const held = await holdForPerson(ctx, call, result.error);
      if (held) return held;
      continue;
    }
    // A cancelled call stays open: the same key runs it again, and close() ends it.
    if (!result.ok && CancelledError.is(result.error)) return result;
    return settle(ctx, call, result, ctx.host.now() - started);
  }
}

async function runTool(ctx: ExternalExecution, call: ExternalCall): AsyncResult<ToolResult> {
  const { toolCallId, options } = call;
  if (options.onProgress) ctx.progress.set(toolCallId, options.onProgress);
  const result = await ctx.executor.execute(call.name, call.input, {
    callId: toolCallId,
    runId: call.log.runId,
    signal: call.signal,
    checkpointsPreapproved: false,
  });
  ctx.progress.delete(toolCallId);
  return result;
}

/** A call waiting for the person: pending after the hold, or undefined once answered (run it again). */
async function holdForPerson(
  ctx: ExternalExecution,
  call: ExternalCall,
  awaiting: TaalcutError,
): Promise<Result<ExternalCallOutcome> | undefined> {
  const approvalId = pendingFor(call.log, call.toolCallId);
  if (!approvalId) return err(awaiting);
  const answered = await waitForAnswer({
    log: call.log,
    requestId: approvalId,
    holdMs: call.options.holdMs,
    signal: call.signal,
    subscribe: ctx.host.subscribe,
    tickMs: ctx.tickMs,
    onTick: () => call.options.onProgress?.(null, WAITING_NOTE),
  });
  if (call.signal.aborted) return err(CancelledError());
  return answered ? undefined : ok({ kind: 'pending', approvalId });
}

/** Logs the call's outcome and answers it: done, declined by the person, or the tool's own error. */
async function settle(
  ctx: ExternalExecution,
  call: ExternalCall,
  result: Result<ToolResult>,
  durationMs: number,
): AsyncResult<ExternalCallOutcome> {
  const key = ctx.idempotencyKeys.get(call.toolCallId);
  const written = await call.log.append(...outcomeEvents(call.log, call.toolCallId, result, durationMs, key));
  if (!written.ok) return written;
  if (result.ok) return ok({ kind: 'done', result: result.value });
  return ToolDenied.is(result.error) ? ok({ kind: 'declined' }) : result;
}
