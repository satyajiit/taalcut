// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The shape of a run's folded state (state.ts folds the log into it). */
import type { Card, EntityRef, GapFixKind, RunId, TaalcutError, ToolRunId } from '@taalcut/core';
import type { AssistantChatMessage } from '@taalcut/models';
import type { RunStatus, StepStatus } from './cards';
import type { EventPayloads, RunBudget } from './events';
import type { FlowStepInfo } from './flow-events';

export interface StepState {
  readonly id: string;
  text: string;
  status: StepStatus;
  turns: number;
  /** A skill step's model turns in a row with no tool call (BRK1-MAKE: the text loop). */
  textTurns?: number;
  /** AGT1: corrective notes written in this step (step.corrected), and textTurns when the last was written. */
  corrections?: number;
  correctedAt?: number;
  /**
   * Where in the transcript the step was last told what to call: a failed check's reason or a corrective note. A
   * bounded offer leads with the tools that note names (context/tool-priority.ts).
   */
  toldAt?: number;
  verifyRetries: number;
  /** The step's last model turn had no tool calls (a skill step: a valid handOff): ready for verification. */
  ended: boolean;
  summary: string;
  readonly skill?: string;
  readonly input?: unknown;
  readonly labelKey?: string;
  readonly flow?: FlowStepInfo;
  /** A flow step the agent runs itself: one call of this tool. */
  readonly tool?: string;
  /** skill.entered: the validated input, when the step began and the run's usage then. */
  entered?: { input: unknown; at: number; usage: { tokens: number; usd: number } };
  /** A valid handOff waiting for the skill's check. */
  handoff?: unknown;
  /** The accepted handoff (skill.handedOff). */
  handedOff?: { output: unknown; refs: EntityRef[]; at: number };
  estimateId?: string;
  /** AGT2: the context window its route was sized by (route.chosen), so every turn offers alike (tool-offer.ts). */
  window?: number;
  /** AGT2: its route's query (route.chosen), which picks the catalogue lines a small window lists (tool-offer.ts). */
  query?: string;
  /** Exact current-step route order, folded from its existing route.chosen event. */
  routedTools?: readonly string[];
  /** Last model offer, from model.requested, to restore controls after a narrow selected-tool turn. */
  lastToolNames?: readonly string[];
  /** Tool steps: the call the agent requested, and how it ended. */
  toolCallId?: string;
  toolOutcome?: 'completed' | 'failed';
}

export interface ToolCallState {
  readonly requested: EventPayloads['tool.requested'];
  readonly requestedAt: number;
  outcome?:
    | { readonly kind: 'completed'; readonly at: number; readonly payload: EventPayloads['tool.completed'] }
    | { readonly kind: 'failed'; readonly at: number; readonly payload: EventPayloads['tool.failed'] };
}

export interface ApprovalState {
  readonly request: EventPayloads['approval.requested'];
  readonly requestedAt: number;
  /** FIX-ASK: where in the log it was asked. */
  readonly requestedSeq?: number;
  status: 'pending' | 'granted' | 'denied';
  answeredAt?: number;
  /** stale: the user changed what it was about, and the flow asks again. */
  deniedReason?: 'stale';
}

/** AGT1: each item notes the plan step it was written in (the index; absent before the first step starts). */
export type TranscriptItem = (
  | { readonly kind: 'user'; readonly text: string }
  | { readonly kind: 'control'; readonly text: string }
  | {
      readonly kind: 'assistant';
      readonly modelCallId: string;
      readonly message: AssistantChatMessage;
      readonly toolCallIds: ToolRunId[];
    }
) & { readonly step?: number };

export interface RunState {
  readonly runId: RunId;
  started?: EventPayloads['run.started'];
  status: RunStatus;
  lastSeq: number;
  plan?: StepState[];
  /** Index of the current step; -1 before the first step starts. */
  stepIndex: number;
  transcript: TranscriptItem[];
  /** Every tool the run's routes and findTools loaded, oldest first; a turn offers the newest its window allows. */
  loadedTools: string[];
  openModelCall?: { readonly modelCallId: string; readonly phase: 'plan' | 'act'; readonly module: string };
  lastTurn?: { readonly phase: 'plan' | 'act'; readonly hadToolCalls: boolean; readonly text: string };
  toolCalls: Record<string, ToolCallState>;
  toolCallOrder: ToolRunId[];
  approvals: Record<string, ApprovalState>;
  /**
   * `tokens` is every token; `paidTokens` (BRK1-MAKE) only those the budget counts: a model turn that didn't run on
   * this Mac, and a tool call that cost money. On-device tokens are free and never stop a run.
   */
  usage: { tokens: number; paidTokens: number; usd: number; activeMs: number };
  /** Model calls only: the price per token this run has paid, for estimates. */
  modelUsage: { tokens: number; usd: number };
  budget: RunBudget;
  /** Budget stops before a model call that the user approved once and that are not used yet. */
  modelBudgetAllowance: number;
  turns: number;
  lastAt: number;
  report?: string;
  error?: TaalcutError;
  /* ---------- Phase 2 (state-flow.ts) ---------- */
  flow?: EventPayloads['flow.started'];
  /** Answers to skill questions in this run, by question. */
  answers: Record<string, number>;
  /** User changes to what finished steps made, in log order. */
  inputChanges: { seq: number; stepIds: string[]; refs: EntityRef[]; commandId: string; applied: boolean }[];
  estimates: Record<
    string,
    { recorded: EventPayloads['estimate.recorded']; settled?: EventPayloads['estimate.settled']['actual'] }
  >;
  /** The latest card sent under each id. */
  cards: Record<string, Card>;
  cancelReason?: 'budget';
  /** Money spent, by model module (model calls and paid tools). */
  spend: Record<string, number>;
  /** The flow's cost was reported as abandoned (no step for 24 hours). */
  flowAbandoned?: boolean;
  /* ---------- Phase 3 (state-phase3.ts) ---------- */
  /** The router's answers, timeouts and the model's overrides, in log order (SPEC section 24). */
  routes: RouteRecord[];
  /** Mode `on`: the family a live route narrowed the coming act turn to ('none': no domain tools). */
  liveRoute?: string;
  /** Optional flow steps that joined the plan, in log order, with the facts they joined on (SPEC section 25). */
  extensions: { extension: string; stepId: string; seq?: number; data?: unknown }[];
  /** Every extension asked at an anchor step, and its answer (asked once per extension and anchor). */
  extensionChecks: EventPayloads['flow.extensionChecked'][];
  /** P3-B8: the user's fix per gap from the gapFix question; [] when they declined. Absent: not asked. */
  gapFixes?: { gapId: string; fix: GapFixKind; swapTo?: { assetId: string; shotId: string | null } }[];
  /** FIX-ASK: the seq of the gapFix question `gapFixes` answers. */
  gapFixesAsked?: number;
  /** G8: the run waits for a model limit to lift until `until` (limit.waiting, until limit.resumed). */
  limitWait?: { requestId: string; until: number };
  /** G8: models chosen on a rateLimit card, by module, for the rest of this run (limit.switched). */
  modelOverrides?: Record<string, { provider: string; model: string }>;
  /**
   * FIX-RUN: by module, whether its last answer cost the person nothing per token (a model on this Mac, or a plan
   * they signed in with). The next turn's estimate counts against no budget when the price lookup can't say.
   */
  freeModules?: Record<string, boolean>;
  /** FIX-RUN: model calls in a row that failed and were tried again (model.failed with `retry`); 0 after an answer. */
  modelRetries?: number;
}

/** One router event as the fold keeps it: agreement and the report are worked out from these. */
export type RouteRecord =
  | ({ readonly kind: 'shadow' } & EventPayloads['route.shadow'])
  | ({ readonly kind: 'timeout' } & EventPayloads['route.timeout'])
  | ({ readonly kind: 'override' } & EventPayloads['route.override']);

export function initialState(runId: RunId): RunState {
  return {
    runId,
    status: 'running',
    lastSeq: -1,
    stepIndex: -1,
    transcript: [],
    loadedTools: [],
    toolCalls: {},
    toolCallOrder: [],
    approvals: {},
    usage: { tokens: 0, paidTokens: 0, usd: 0, activeMs: 0 },
    modelUsage: { tokens: 0, usd: 0 },
    budget: {},
    modelBudgetAllowance: 0,
    turns: 0,
    lastAt: 0,
    answers: {},
    inputChanges: [],
    estimates: {},
    cards: {},
    spend: {},
    routes: [],
    extensions: [],
    extensionChecks: [],
  };
}
