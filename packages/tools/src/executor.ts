// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Runs the fixed SPEC.md pipeline; independent calls can execute concurrently. */
import {
  err,
  newId,
  ok,
  toolNeedsApproval,
  type AnyTool,
  type ArtifactStore,
  type AsyncResult,
  type Result,
  type RunId,
  type TaalcutError,
  type ToolEditorContext,
  type ToolRunId,
  type ToolUsage,
} from '@taalcut/core';
import { z } from 'zod';
import { invalidInputDetail, parseToolInput } from './invalid-input';
import { runWithRetries } from './attempts';
import { buildToolContext, sumUsage, ZERO_USAGE } from './context';
import {
  ToolApprovalRequired,
  ToolAwaitingApproval,
  ToolCrashed,
  ToolDenied,
  ToolInvalidInput,
  ToolInvalidOutput,
  ToolNotFound,
  ToolPermissionDenied,
  ToolScopeRequired,
} from './errors';
import { estimateFor } from './estimate';
import { toolInputHash } from './hash';
import { callSummary, DEFAULT_INLINE_OUTPUT_LIMIT, toToolOutput } from './output';
import type {
  IdempotencyStore,
  IdempotentOutcome,
  ToolCallOrigin,
  ToolCommandBus,
  ToolDecision,
  ToolEvent,
  ToolGateRequest,
  ToolPolicy,
  ToolResult,
  ToolResultCache,
  ToolUsageTotal,
} from './ports';
import type { RegisteredTool, ToolRegistry } from './registry';
import { crashDetail, scrubError } from './scrub';
import { createMemoryIdempotencyStore, createMemoryToolCache } from './stores';

export interface ToolExecutorOptions {
  readonly registry: Pick<ToolRegistry, 'resolve'>;
  /** Without a policy, everything is allowed except destructive and external tools, which are refused. */
  readonly policy?: ToolPolicy;
  readonly commands?: ToolCommandBus;
  readonly artifacts?: ArtifactStore;
  readonly cache?: ToolResultCache;
  readonly idempotency?: IdempotencyStore;
  /** Tracing. Exceptions thrown by the listener are swallowed: tracing never breaks a run. */
  readonly onEvent?: (event: ToolEvent) => void;
  readonly inlineOutputLimit?: number;
  readonly now?: () => number;
  readonly random?: () => number;
}

export interface ToolCallOptions {
  /** Reuse the id from the run log when re-executing a call after a pause or crash. */
  readonly callId?: ToolRunId;
  readonly runId?: RunId;
  /**
   * What idempotency keys are scoped to when the call is not part of an agent
   * run (a skill invocation id, say). Default: `runId`. A tool that changes
   * state needs one or the other.
   */
  readonly scope?: string;
  readonly signal?: AbortSignal;
  /**
   * Checkpoint tools (render, export) need an approval id like destructive and
   * external ones, unless the user's autonomy level lets them run unasked
   * (autopilot). Default false, so forgetting it errs on the side of asking.
   */
  readonly checkpointsPreapproved?: boolean;
  /** Semver range, e.g. '^1'. Default: the latest registered version. */
  readonly version?: string;
  /**
   * Who the call is for, passed to every command the tool dispatches. Default: the built-in agent. An MCP
   * client's calls pass `{ source: 'mcp', actor: 'mcp:<sessionId>' }` (P3-V4), so the audit log says so.
   */
  readonly origin?: ToolCallOrigin;
  /** EDT1-OPS: in a docked message's run, what the person pointed at; the tool reads it as ctx.editor. */
  readonly editor?: ToolEditorContext;
  /** Per-call override for inline JSON output byte limit before spilling to an artifact. */
  readonly inlineOutputLimit?: number;
}

export interface ToolExecutor {
  /** `name` may be the tool name or the provider-safe call name. Never throws. */
  execute(name: string, input: unknown, options?: ToolCallOptions): AsyncResult<ToolResult>;
}

interface CallState {
  readonly callId: ToolRunId;
  readonly runId?: RunId;
  readonly startedAt: number;
  attempts: number;
  cached: boolean;
  deduplicated: boolean;
  /**
   * The call failed after run() may have had its effect: it threw, timed out mid-run, returned invalid output, or
   * it spends money and run() got as far as returning an error (it may have paid before the step that failed).
   */
  uncertain: boolean;
  usage: ToolUsageTotal;
}

export function createToolExecutor(options: ToolExecutorOptions): ToolExecutor {
  const now = options.now ?? Date.now;
  const random = options.random ?? Math.random;
  const cache = options.cache ?? createMemoryToolCache({ now });
  const idempotency = options.idempotency ?? createMemoryIdempotencyStore();
  const inlineLimit = options.inlineOutputLimit ?? DEFAULT_INLINE_OUTPUT_LIMIT;
  const inFlight = new Map<string, Promise<Result<ToolResult>>>();

  const emit = (event: ToolEvent) => {
    try {
      options.onEvent?.(event);
    } catch {
      // Tracing must never break a run.
    }
  };

  async function execute(name: string, input: unknown, call: ToolCallOptions = {}): AsyncResult<ToolResult> {
    const tool = options.registry.resolve(name, call.version);
    const state: CallState = {
      callId: call.callId ?? newId<'ToolRun'>(),
      ...(call.runId ? { runId: call.runId } : {}),
      startedAt: now(),
      attempts: 0,
      cached: false,
      deduplicated: false,
      uncertain: false,
      usage: ZERO_USAGE,
    };
    const toolName = tool?.descriptor.name ?? name;
    const version = tool?.descriptor.version;
    emit({
      type: 'tool.started',
      callId: state.callId,
      runId: state.runId,
      tool: toolName,
      version,
      at: state.startedAt,
    });

    let result: Result<ToolResult>;
    try {
      result = tool ? await pipeline(tool, input, call, state) : err(ToolNotFound({ tool: name }));
    } catch (cause) {
      result = err(ToolCrashed({ tool: toolName }, { detail: crashDetail(cause) }));
    }
    // A tool's own error may quote a token or a signed URL; the run log and traces must not.
    if (!result.ok) result = err(scrubError(result.error));
    const at = now();
    emit({
      type: 'tool.finished',
      callId: state.callId,
      runId: state.runId,
      tool: toolName,
      version,
      at,
      durationMs: at - state.startedAt,
      attempts: state.attempts,
      cached: state.cached,
      deduplicated: state.deduplicated,
      usage: state.usage,
      ...(result.ok ? {} : { error: result.error }),
    });
    return result;
  }

  async function pipeline(
    tool: RegisteredTool,
    rawInput: unknown,
    call: ToolCallOptions,
    state: CallState,
  ): AsyncResult<ToolResult> {
    const { spec, descriptor } = tool;
    const parsed = parseToolInput(spec.input, spec.mendInput ? spec.mendInput(rawInput) : rawInput);
    if (!parsed.success) {
      // AGT1: the refusal shows the model its own call mended.
      return err(
        ToolInvalidInput({ tool: spec.name }, { detail: invalidInputDetail(rawInput, parsed.error) }),
      );
    }
    const input = parsed.data;
    const inputHash = toolInputHash(descriptor, input);
    const gate: ToolGateRequest = {
      tool: descriptor,
      input,
      inputHash,
      callId: state.callId,
      runId: state.runId,
    };

    const permission = await options.policy?.checkPermission?.(gate);
    if (permission && permission.kind !== 'allow')
      return err(refusal(permission, spec.name, ToolPermissionDenied));

    if (descriptor.cacheable) {
      const hit = await cache.get(inputHash);
      if (hit) {
        state.cached = true;
        return ok(
          finish(spec, state, {
            inputHash,
            value: hit.value,
            output: hit.output,
            ...callSummary(spec, input, hit.value),
          }),
        );
      }
    }

    // Scoped to the run: the same action asked for in a later run is a new request. There is
    // no shared bucket for calls without a run: a read tool just runs, any other is refused.
    const scope = call.scope ?? call.runId;
    const changesState = descriptor.sideEffect !== 'read';
    if (!spec.idempotencyKey || (scope === undefined && !changesState))
      return runFresh(tool, input, inputHash, gate, call, state);
    if (scope === undefined) return err(ToolScopeRequired({ tool: spec.name }));
    const key = `${scope}:${spec.name}:${spec.idempotencyKey(input)}`;

    const done = await idempotency.get(key);
    if (done) return replayed(done, state);
    const running = inFlight.get(key);
    if (running) {
      const first = await running;
      return first.ok ? ok(asDuplicate(first.value, state)) : first;
    }
    const promise = runFresh(tool, input, inputHash, gate, call, state, key);
    inFlight.set(key, promise);
    try {
      const result = await promise;
      if (result.ok) await idempotency.set(key, { ok: true, result: result.value });
      // The effect may have happened: a repeat gets this error instead of doing it again.
      else if (state.uncertain && changesState)
        await idempotency.set(key, { ok: false, callId: state.callId, error: scrubError(result.error) });
      return result;
    } finally {
      inFlight.delete(key);
    }
  }

  async function runFresh(
    tool: RegisteredTool,
    input: unknown,
    inputHash: string,
    gate: ToolGateRequest,
    call: ToolCallOptions,
    state: CallState,
    idempotencyKey?: string,
  ): AsyncResult<ToolResult> {
    const { spec, descriptor } = tool;
    // The bound, or the tool's closer refinement when it answers in time (estimate.ts).
    const estimate = await estimateFor(spec, input, call.signal ? { signal: call.signal } : {});
    // The backstop under the policy: these never run on an 'allow' without an approval id.
    const approvalRequired =
      toolNeedsApproval(descriptor) || (descriptor.checkpoint && call.checkpointsPreapproved !== true);
    const decision: ToolDecision = options.policy?.authorize
      ? await options.policy.authorize({ ...gate, ...(estimate ? { estimate } : {}), approvalRequired })
      : { kind: 'allow' };
    if (decision.kind !== 'allow') return err(refusal(decision, spec.name, ToolDenied));
    if (approvalRequired && !decision.approvalId) return err(ToolApprovalRequired({ tool: spec.name }));

    const usages: ToolUsage[] = [];
    const outcome = await runWithRetries(
      (signal, attempt) =>
        spec.run(
          input,
          buildToolContext({
            spec,
            callId: state.callId,
            ...(state.runId ? { runId: state.runId } : {}),
            signal,
            attempt,
            usages,
            ...(estimate ? { estimate } : {}),
            ...(idempotencyKey ? { idempotencyKey } : {}),
            ...(options.artifacts ? { artifacts: options.artifacts } : {}),
            ...(options.commands ? { commands: options.commands } : {}),
            ...(call.origin ? { origin: call.origin } : {}),
            ...(call.editor ? { editor: call.editor } : {}),
            emit,
          }),
        ),
      {
        timeoutMs: descriptor.timeoutMs,
        retry: descriptor.retry,
        // A timed-out write may already have happened; only reads are tried again.
        retryTimeouts: descriptor.sideEffect === 'read',
        ...(call.signal ? { signal: call.signal } : {}),
        random,
        onThrow: (cause) => ToolCrashed({ tool: spec.name }, { detail: crashDetail(cause) }),
        onRetry: (attempt, delayMs, error) =>
          emit({ type: 'tool.retrying', callId: state.callId, attempt, delayMs, error }),
      },
    );
    state.attempts = outcome.attempts;
    state.usage = sumUsage(usages);
    if (!outcome.result.ok) {
      state.uncertain =
        outcome.unsettled || ToolCrashed.is(outcome.result.error) || spends(descriptor, state.usage);
      return outcome.result;
    }

    const checked = spec.output.safeParse(outcome.result.value);
    if (!checked.success) {
      // run() succeeded, so its effect happened; only its answer is unusable.
      state.uncertain = true;
      return err(ToolInvalidOutput({ tool: spec.name }, { detail: z.prettifyError(checked.error) }));
    }
    const value = checked.data;
    const output = await toToolOutput(spec, value, options.artifacts, call.inlineOutputLimit ?? inlineLimit);
    if (descriptor.cacheable) await cache.set(inputHash, { value, output }, descriptor.cacheTtlMs);
    return ok(
      finish(spec, state, {
        inputHash,
        value,
        output,
        ...callSummary(spec, input, value),
        ...(estimate ? { estimate } : {}),
        ...(decision.approvalId ? { approvalId: decision.approvalId } : {}),
      }),
    );
  }

  function finish(
    spec: AnyTool,
    state: CallState,
    parts: Pick<ToolResult, 'inputHash' | 'value' | 'output' | 'summary' | 'estimate' | 'approvalId'>,
  ): ToolResult {
    return {
      callId: state.callId,
      tool: spec.name,
      version: spec.version,
      usage: state.usage,
      cached: state.cached,
      deduplicated: state.deduplicated,
      attempts: state.attempts,
      durationMs: now() - state.startedAt,
      ...parts,
    };
  }

  function replayed(done: IdempotentOutcome, state: CallState): Result<ToolResult> {
    state.deduplicated = true;
    return done.ok ? ok(asDuplicate(done.result, state)) : err(done.error);
  }

  function asDuplicate(first: ToolResult, state: CallState): ToolResult {
    state.deduplicated = true;
    return {
      ...first,
      callId: state.callId,
      deduplicated: true,
      sameAs: first.callId,
      attempts: 0,
      usage: ZERO_USAGE,
      durationMs: now() - state.startedAt,
    };
  }

  return { execute };
}

/**
 * A paid tool's failed run may have billed before the step that failed (a provider call, then a placement that
 * conflicts), and so did any run that reported usage before failing. Its error is kept under the key, so the model
 * asking again in the same run gets that error rather than paying twice (review H2); the person's next message is
 * a new run and may try again. Refusals before run() (permission, budget, approval) never get here.
 */
function spends(descriptor: Pick<RegisteredTool['descriptor'], 'costClass'>, usage: ToolUsageTotal): boolean {
  return descriptor.costClass === 'paid' || usage.usd > 0 || usage.inputTokens + usage.outputTokens > 0;
}

function refusal(
  decision: Exclude<ToolDecision, { kind: 'allow' }>,
  tool: string,
  deny: (params: { tool: string }, extras: { detail: string }) => TaalcutError,
): TaalcutError {
  return decision.kind === 'defer'
    ? ToolAwaitingApproval({ tool }, { detail: decision.reason })
    : deny({ tool }, { detail: decision.reason });
}
