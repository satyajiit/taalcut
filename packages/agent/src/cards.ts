// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Card payloads the agent emits (PRD 9.2, P1-H4) and the other UI events.
 * Plain typed objects; the core owner is defining the official card protocol,
 * so they all live in this one file to make the swap a single edit. User-facing
 * text is never built here: cards carry data and i18n keys only.
 */
import type { RunId, TaalcutError, ToolRunId, ToolSideEffect } from '@taalcut/core';
import type { BudgetLimit, PlanStep, UploadScope } from './events';

export type PlanCard = {
  readonly kind: 'plan';
  readonly runId: RunId;
  readonly steps: readonly (PlanStep & { readonly status: StepStatus })[];
};

export type StepStatus = 'todo' | 'doing' | 'done' | 'failed' | 'skipped';

export type ApprovalCard = {
  readonly kind: 'approval';
  readonly runId: RunId;
  readonly requestId: string;
  readonly calls: readonly {
    readonly toolCallId: string;
    readonly tool: string;
    readonly sideEffect: ToolSideEffect;
    readonly input: unknown;
  }[];
};

export type CostEstimateCard = {
  readonly kind: 'costEstimate';
  readonly runId: RunId;
  readonly requestId: string;
  readonly limit: BudgetLimit;
  readonly used: number;
  readonly max: number;
  readonly estimate: { readonly usd: number; readonly tokens: number };
  /** The buttons: approve this once, raise the budget, or stop. */
  readonly options: readonly ('approve-once' | 'raise-budget' | 'stop')[];
};

/**
 * Before the user's media leaves the device (PRD G9): what (the call and its
 * files), where (modules and providers) and the cost. Buttons: Allow once,
 * Always allow for these modules, Don't send; no Always allow for a tool
 * that asks every time (EAR1-R3).
 */
export type ConsentCard = {
  readonly kind: 'consent';
  readonly runId: RunId;
  readonly requestId: string;
  readonly toolCallId: string;
  readonly tool: string;
  /** The call's input, e.g. which frame of which file at what size. */
  readonly input: unknown;
  readonly upload: Readonly<UploadScope>;
  readonly estimate?: { readonly usd: number; readonly tokens: number };
  readonly options: readonly ('allow-once' | 'always-allow' | 'deny')[];
};

export type ErrorCard = { readonly kind: 'error'; readonly runId: RunId; readonly error: TaalcutError };

export type ProgressCard = {
  readonly kind: 'progress';
  readonly runId: RunId;
  readonly toolCallId: ToolRunId;
  readonly tool: string;
  readonly fraction: number;
  readonly note?: string;
};

export type ToolRunCard = {
  readonly kind: 'toolRun';
  readonly runId: RunId;
  readonly toolCallId: string;
  readonly tool: string;
  readonly status: 'running' | 'done' | 'failed' | 'awaiting-approval';
  readonly cached?: boolean;
  readonly errorCode?: string;
  /** FIX-TOOLGROUPS: what the call was about ("IMG_0412.MOV · 0:48"), once it is done. */
  readonly summary?: string;
};

export type AgentCard =
  PlanCard | ApprovalCard | ConsentCard | CostEstimateCard | ErrorCard | ProgressCard | ToolRunCard;

export type RunStatus = 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

export type AgentUiEvent =
  | { readonly type: 'agent.card'; readonly card: AgentCard }
  /** Text as the model streams it; `modelCallId` is the model.requested/responded the text belongs to. */
  | {
      readonly type: 'agent.text.delta';
      readonly runId: RunId;
      readonly modelCallId: string;
      readonly delta: string;
    }
  | {
      readonly type: 'agent.reasoning.delta';
      readonly runId: RunId;
      readonly modelCallId: string;
      readonly delta: string;
    }
  | {
      readonly type: 'agent.run.status';
      readonly runId: RunId;
      readonly status: RunStatus;
      readonly report?: string;
    };
