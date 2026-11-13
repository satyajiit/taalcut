// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The ModelClient contract: one interface for every chat model, local or cloud. */
import type { AsyncResult, ChatEffort, CloudCallId, ProjectId, TaalcutError } from '@taalcut/core';
import type { ModelChoice, ModuleId, ReasoningLevel } from '../modules';
import type { AssistantChatMessage, ChatMessage, ToolCall } from './messages';
import type { ToolSpec } from './tools';

export interface ModelRequest {
  /** Which module is calling; picks the model from the active profile and labels the cloud-call log. */
  readonly module: ModuleId;
  /** Skip the profile and use exactly this model (no fallback chain). */
  readonly target?: ModelChoice;
  readonly system?: string;
  readonly messages: readonly ChatMessage[];
  readonly tools?: readonly ToolSpec[];
  /** Overrides the reasoning level from the profile or target. */
  readonly reasoning?: ReasoningLevel;
  /**
   * The chat's effort (core's chat/effort.ts). Overrides `reasoning`: each
   * model in the chain gets the level it has for this effort, so a fallback
   * to another provider still thinks as hard as it can.
   */
  readonly effort?: ChatEffort;
  readonly maxTokens?: number;
  readonly temperature?: number;
  readonly toolChoice?: 'auto' | 'none';
  readonly signal?: AbortSignal;
  /** Lets providers reuse a prompt cache across the turns of one conversation. */
  readonly sessionId?: string;
  /** Correlates the cloud-call record with an agent run or trace span, and the project it worked for. */
  readonly trace?: { readonly runId?: string; readonly spanId?: string; readonly projectId?: ProjectId };
}

/** Tokens and money for one call. Cost comes from pi-ai's per-model prices, in US dollars. */
export interface CallUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** Prompt tokens served from the provider's cache (billed at the cache-read rate). */
  readonly cachedInputTokens: number;
  readonly cacheWriteTokens: number;
  /** Reasoning tokens, a subset of outputTokens, when the provider reports them. */
  readonly reasoningTokens?: number;
  readonly totalTokens: number;
  readonly costUsd: number;
}

export type StopReason = 'stop' | 'length' | 'tool_use';

export interface ModelResult {
  readonly callId: CloudCallId;
  readonly module: ModuleId;
  readonly provider: string;
  readonly model: string;
  readonly reasoning: ReasoningLevel;
  readonly message: AssistantChatMessage;
  /** All text parts joined. */
  readonly text: string;
  readonly toolCalls: readonly ToolCall[];
  readonly stopReason: StopReason;
  readonly usage: CallUsage;
  readonly latencyMs: number;
  /** True when the model ran on this machine (Ollama, LM Studio). */
  readonly local: boolean;
  /**
   * FIX-RUN: true when a plan the person signed in with (ChatGPT, Claude, Grok) paid for the call: its tokens are
   * free to them, so no token budget counts them. Absent for an API key or a model on this Mac.
   */
  readonly planBilled?: boolean;
}

export type ModelEvent =
  | {
      readonly type: 'start';
      readonly callId: CloudCallId;
      readonly module: ModuleId;
      readonly provider: string;
      readonly model: string;
      readonly reasoning: ReasoningLevel;
      readonly local: boolean;
    }
  | { readonly type: 'text_delta'; readonly index: number; readonly delta: string }
  | { readonly type: 'reasoning_delta'; readonly index: number; readonly delta: string }
  | { readonly type: 'tool_call'; readonly index: number; readonly call: ToolCall }
  /** The chain moved on: `from` failed with `reason` before producing output, `to` runs next. */
  | {
      readonly type: 'fallback';
      readonly from: ModelChoice;
      readonly to: ModelChoice;
      readonly reason: TaalcutError;
    }
  | { readonly type: 'usage'; readonly callId: CloudCallId; readonly usage: CallUsage }
  | { readonly type: 'done'; readonly result: ModelResult }
  | { readonly type: 'error'; readonly error: TaalcutError };

/**
 * A running call. Iterate it for live events, or await result(). The call starts
 * immediately; events are buffered until read. It ends with exactly one 'done'
 * or 'error' event, and result() settles with the same outcome.
 */
export interface ModelStream extends AsyncIterable<ModelEvent> {
  result(): AsyncResult<ModelResult>;
}

export interface ModelClient {
  stream(request: ModelRequest): ModelStream;
  /** Runs the call to the end and returns the outcome. */
  complete(request: ModelRequest): AsyncResult<ModelResult>;
}
