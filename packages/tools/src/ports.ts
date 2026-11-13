// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Types the executor returns and the ports it is wired with. The agent
 * implements ToolPolicy (autonomy, budgets, approvals) and listens to
 * ToolEvents (tracing); the composition root adapts core's command bus and the
 * artifact store.
 */
import type {
  ArtifactRef,
  AsyncResult,
  RunId,
  TaalcutError,
  ToolCostEstimate,
  ToolRunId,
} from '@taalcut/core';
import type { ToolDescriptor } from './descriptor';

/** What the model and the run log get: the value itself, or a reference when it is large. */
export type ToolOutput =
  | { readonly kind: 'inline'; readonly value: unknown }
  | { readonly kind: 'artifact'; readonly ref: ArtifactRef };

export interface ToolUsageTotal {
  readonly usd: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface ToolResult<O = unknown> {
  readonly callId: ToolRunId;
  readonly tool: string;
  readonly version: string;
  /** Content hash of (tool, version, input): the cache key, and what replay matches on. */
  readonly inputHash: string;
  /** The full, validated output, for code (skills hand typed objects to each other). */
  readonly value: O;
  /** What goes to the model and into the run log. */
  readonly output: ToolOutput;
  /** FIX-TOOLGROUPS: what the call was about, for people (the tool's describeCall, one bounded line). Never to the model. */
  readonly summary?: string;
  readonly usage: ToolUsageTotal;
  readonly cached: boolean;
  readonly deduplicated: boolean;
  /** For a de-duplicated result: the call that actually ran. */
  readonly sameAs?: ToolRunId;
  /** 0 when served from the cache or de-duplicated. */
  readonly attempts: number;
  readonly durationMs: number;
  readonly estimate?: ToolCostEstimate;
  /** The approval the policy gave; always present for destructive, external and (unless preapproved) checkpoint tools. */
  readonly approvalId?: string;
}

/* ---------- Policy: where the agent's permission, budget and autonomy rules plug in ---------- */

export interface ToolGateRequest {
  readonly tool: ToolDescriptor;
  /** The validated input. */
  readonly input: unknown;
  readonly inputHash: string;
  readonly callId: ToolRunId;
  readonly runId?: RunId;
}

export interface ToolAuthorizeRequest extends ToolGateRequest {
  /** From the tool's estimateCost(), for the budget check and the cost card. */
  readonly estimate?: ToolCostEstimate;
  /**
   * True for destructive and external tools, and for checkpoint tools unless
   * the call says they're preapproved: an 'allow' must carry an approvalId.
   */
  readonly approvalRequired: boolean;
}

/**
 * 'defer' means "ask the user and pause": the call fails with
 * tools.awaiting_approval, the run checkpoints, and the same call (same
 * callId) is executed again once the user answers.
 */
export type ToolDecision =
  | { readonly kind: 'allow'; readonly approvalId?: string }
  | { readonly kind: 'deny'; readonly reason: string }
  | { readonly kind: 'defer'; readonly reason: string };

export interface ToolPolicy {
  /** Settings checks with no user prompt: local-only mode, granted folders, network. */
  checkPermission?(request: ToolGateRequest): ToolDecision | Promise<ToolDecision>;
  /** Budget and autonomy: may show a cost or approval card. Called after the cost estimate. */
  authorize?(request: ToolAuthorizeRequest): ToolDecision | Promise<ToolDecision>;
}

/* ---------- Tracing ---------- */

export type ToolEvent =
  | {
      readonly type: 'tool.started';
      readonly callId: ToolRunId;
      readonly runId?: RunId;
      readonly tool: string;
      readonly version?: string;
      readonly at: number;
    }
  | {
      readonly type: 'tool.retrying';
      readonly callId: ToolRunId;
      /** The attempt that failed. */
      readonly attempt: number;
      readonly delayMs: number;
      readonly error: TaalcutError;
    }
  | {
      readonly type: 'tool.progress';
      readonly callId: ToolRunId;
      readonly fraction: number;
      readonly note?: string;
    }
  | {
      readonly type: 'tool.finished';
      readonly callId: ToolRunId;
      readonly runId?: RunId;
      readonly tool: string;
      readonly version?: string;
      readonly at: number;
      readonly durationMs: number;
      readonly attempts: number;
      readonly cached: boolean;
      readonly deduplicated: boolean;
      readonly usage: ToolUsageTotal;
      readonly error?: TaalcutError;
    };

/* ---------- Services the executor is wired with ---------- */

/** Who a call is for: the built-in agent, or an external agent over MCP (P3-V4). */
export interface ToolCallOrigin {
  readonly source: 'agent' | 'mcp';
  /** 'mcp:<sessionId>' for an MCP session; the agent's own calls carry none (the bus uses 'agent:<runId>'). */
  readonly actor?: string;
}

export interface ToolDispatchMeta {
  readonly source: 'agent' | 'mcp';
  readonly actor?: string;
  readonly tool: string;
  readonly callId: ToolRunId;
  readonly runId?: RunId;
  /** The tool's idempotency key, so the bus can refuse to apply the same command twice after a crash. */
  readonly idempotencyKey?: string;
  /** The attempt's signal: aborted on timeout and on cancel, so the bus can drop a command not yet applied. */
  readonly signal?: AbortSignal;
}

/** Adapter over core's command bus. */
export interface ToolCommandBus {
  dispatch(command: string, payload: unknown, meta: ToolDispatchMeta): AsyncResult<unknown>;
}

export interface CachedToolOutput {
  readonly value: unknown;
  readonly output: ToolOutput;
}

/** Result cache keyed by content hash. In memory by default; the agent may persist it. */
export interface ToolResultCache {
  get(hash: string): Promise<CachedToolOutput | undefined>;
  set(hash: string, entry: CachedToolOutput, ttlMs?: number): Promise<void>;
}

/**
 * How a keyed call ended. Failures are remembered only when the side effect
 * may have happened anyway (the tool ran but its output was invalid, it threw,
 * or it was still running at the timeout), so a repeat doesn't do it twice.
 */
export type IdempotentOutcome =
  | { readonly ok: true; readonly result: ToolResult }
  | { readonly ok: false; readonly callId: ToolRunId; readonly error: TaalcutError };

/** Outcomes by idempotency key (`scope:tool:key`, scope = the run). The agent backs it with the run log. */
export interface IdempotencyStore {
  get(key: string): Promise<IdempotentOutcome | undefined>;
  set(key: string, outcome: IdempotentOutcome): Promise<void>;
}
