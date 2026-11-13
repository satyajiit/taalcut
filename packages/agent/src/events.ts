// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The run's event log format (SPEC section 4). Every event is an envelope { runId, seq, type, v, at, payload }; `v` is
 * the payload version for its type, and upcasters lift old payloads to the current version on read, so logs written by
 * older builds stay readable. Unknown types pass through and are ignored by the fold.
 */
import type {
  ChatEffort,
  EditorContext,
  ChatStart,
  CommentBatch,
  QuestionAnswer,
  ReferencePointer,
  RouterSetting,
  RunId,
  SelectionChip,
  SkillQuestion,
  SoulDials,
  TaalcutError,
  ToolRunId,
  ToolSideEffect,
  UploadMediaKind,
  UploadSource,
} from '@taalcut/core';
import type { AssistantChatMessage, CallUsage, ReasoningLevel, StopReason, ToolCall } from '@taalcut/models';
import type { ToolOutput, ToolUsageTotal } from '@taalcut/tools';
import { z } from 'zod';
import {
  FLOW_EVENT_VERSIONS,
  type CheaperChoice,
  type FlowEventPayloads,
  type FlowStepInfo,
} from './flow-events';
import type { ExternalRunInfo } from './external/external-types';
import type { RateLimitAsk } from './limits/limit-events';
import type { RecalledMemory } from './memory/memory-port';
import type { EditorBrief } from './editor/editor-brief';
import type { RunHistory } from './history-types';
import { PHASE3_EVENT_VERSIONS, type Phase3EventPayloads } from './phase3-events';

export const AUTONOMY_LEVELS = ['every-step', 'before-render', 'autopilot'] as const;
export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number];

export interface RunBudget {
  readonly maxTokens?: number;
  readonly maxUsd?: number;
  readonly maxWallClockMs?: number;
}
/** projectCap: the project's spending cap (P2-X1), checked before paid work. */
export type BudgetLimit = 'tokens' | 'usd' | 'wallClock' | 'projectCap';
/**
 * tool: approve a step. budget: go over a limit. consent: send the user's media to a cloud model.
 * question: a skill's question (how many variants).
 */
export type ApprovalKind = 'tool' | 'budget' | 'consent' | 'question' | 'rateLimit';

/** What an upload would send, and where (PRD G9). */
export interface UploadScope {
  /** Cloud modules the tool uses, e.g. ['vision']. */
  modules: string[];
  /** Cloud providers those modules may send to now; empty if the composition root doesn't say. */
  providers: string[];
  /** Files whose content would leave the device, from the call's input. */
  files: string[];
  /** Source of each file (`user-media` vs `reference`), in the same order as `files`. */
  sources?: UploadSource[];
  /** EAR1-I5: the kind of media the tool names (`permission.uploads.media`), with standing consents of its own. */
  media?: UploadMediaKind;
}

export type { HistoryTurn, RunHistory } from './history-types';

export interface PlanStep {
  readonly id: string;
  /** Model-written; empty on seeded flow steps, which carry `labelKey`. */
  readonly text: string;
  /** The skill this step runs. */
  readonly skill?: string;
  /** The skill's input, when the model gives it (flows build it from earlier handoffs instead). */
  readonly input?: unknown;
  /** i18n key shown when `text` is empty. */
  readonly labelKey?: string;
  /** Set on flow steps. */
  readonly flow?: FlowStepInfo;
  /** A flow step the agent runs itself, with no model turn: one call of this tool (the export). */
  readonly tool?: string;
}

export type ModelRetry = { attempt: number; of: number; delayMs: number };
export interface EventPayloads extends FlowEventPayloads, Phase3EventPayloads {
  'run.started': {
    /** EDT2: persisted ownership; absent in earlier logs that never paused manual editing. */
    editingProjectId?: string;
    editingContext?: EditorContext;
    editingTargets?: string[];
    conversationId: string;
    projectId?: string;
    message: string;
    autonomy: AutonomyLevel;
    budget: RunBudget;
    localOnly: boolean;
    soulVersion: string;
    catalogueHash: string;
    /** The conversation so far, when the run continues one: the start of every prompt in the run. */
    history?: RunHistory;
    /**
     * How hard the model thinks on every turn of the run (the chat's effort,
     * core's chat/effort.ts). Absent: the model's own level. Logged so a
     * resumed or replayed run thinks as hard as it first did.
     */
    effort?: ChatEffort;
    /**
     * UX3-AGT: the exact level the chat picked (one of its model's), which replaces `effort`: the model it was
     * picked for runs at it, a fallback model at the nearest level it has. Logged for the same reason.
     */
    reasoning?: ReasoningLevel;
    /** The opening card's choice: the run starts that flow with no planning turn. */
    start?: ChatStart;
    /** What the user pointed at; the first prompt lists them. */
    selections?: SelectionChip[];
    /** The conversation's latest flow (from an earlier run), whose card ids a re-entered skill reuses. */
    lastFlow?: { flowId: string; projectId?: string };
    /** Soul v1: SOUL.md's version and the dials the run's prompt was built with (absent before Phase 3). */
    soul?: { version: string; dials: SoulDials };
    /** P3-V15: what the message pointed at ("the transition at 0:04"), resolved once at the start. */
    pointers?: ReferencePointer[];
    /** P3-B11: the router's rollout setting the run started with (absent: off). Every turn of the run uses it. */
    router?: RouterSetting;
    /** P3-V4: a run an external agent drives over MCP: no model loop, one tool call at a time. */
    external?: ExternalRunInfo;
    /** The "[Taalcut] The user pointed at:" note built with them (ids, both videos' times, intents). */
    pointerNote?: string;
    /** LRN1-MEM: the memory recalled at the start (or why none was); every system prompt of the run ends with it. */
    memory?: RecalledMemory;
    /** EDT1-CMT: the comments the message sent, read once at the start; the Editor answers each (comments/). */
    comments?: CommentBatch;
    /** EDT1-CTX: a docked message's editor brief (editor/editor-brief.ts); every system prompt of the run ends with it. */
    editor?: EditorBrief;
  };
  'plan.created': { steps: PlanStep[] };
  /**
   * Known ids keep their place (text updated); new steps go at the end, or right after `insertAfter`
   * (flow follow-ups). `applies` lists the flow.inputChanged seqs this update takes care of.
   */
  'plan.updated': { steps: PlanStep[]; insertAfter?: string; applies?: number[] };
  'step.started': { stepId: string; index: number; text: string };
  /**
   * by: how the tools were picked (the step text's search, or the router's live family). Absent: search. AGT2: `tools`
   * is the step's offer when it starts (every tool, for a step offered them all), and `window` the context window it
   * was sized by (tool-offer.ts); absent: not known, the smallest offer.
   */
  'route.chosen': {
    stepId: string;
    query: string;
    tools: string[];
    by?: 'search' | 'router';
    family?: string;
    window?: number;
  };
  'model.requested': {
    modelCallId: string;
    phase: 'plan' | 'act';
    promptHash: string;
    toolNames: string[];
    estimate: { tokens: number; usd: number };
    /** The call goes ahead over budget on a one-time approval, which it uses up. */
    overBudget?: boolean;
    /** The model module the call runs on: a skill's own, else 'agent'. Absent in older logs. */
    module?: string;
  };
  'model.responded': {
    modelCallId: string;
    provider: string;
    model: string;
    local: boolean;
    message: AssistantChatMessage;
    text: string;
    toolCalls: ToolCall[];
    usage: CallUsage;
    latencyMs: number;
    stopReason: StopReason;
    /** The reasoning level the model ran at (the effort mapped onto its levels). Absent in older logs. */
    reasoning?: ReasoningLevel;
    planBilled?: boolean; // FIX-RUN: a plan the person signed in with paid; its tokens count against no budget.
  };
  /** `retry` (FIX-RUN): the call dropped and is tried again after `delayMs`, as retry `attempt` of `of`. */
  'model.failed': { modelCallId: string; error: TaalcutError; retry?: ModelRetry };
  'tool.requested': {
    toolCallId: ToolRunId;
    modelCallId: string;
    modelToolCallId: string;
    /** Canonical tool name ('media.probe'), or the pseudo-tool name ('findTools'). */
    tool: string;
    /** The name the model used ('media_probe'); tool results go back under it. */
    callName: string;
    meta: boolean;
    input: unknown;
    sideEffect: ToolSideEffect;
    /** The cloud module the tool's paid usage is counted under (cost by module). */
    cloudModule?: string;
    /** The tool has its own approval or result card (the chat shows it instead of the generic one). */
    cards?: { approval?: boolean; result?: boolean };
  };
  'tool.completed': {
    toolCallId: ToolRunId;
    version?: string;
    inputHash?: string;
    output: ToolOutput;
    cached: boolean;
    deduplicated: boolean;
    attempts: number;
    durationMs: number;
    usage: ToolUsageTotal;
    approvalId?: string;
    idempotencyKey?: string;
    /** findTools: the tools it loaded for later turns. */
    loaded?: string[];
    /** handOff: the validated output, the step's handoff candidate. */
    handoff?: unknown;
    /** A card.sent with this call's result card follows in the same append. */
    resultCard?: boolean;
    /**
     * FIX-TOOLGROUPS: what the call was about, for people ("IMG_0412.MOV · 0:48"): the tool's describeCall, one
     * bounded line. The chat shows it on the call's row; it never goes to the model.
     */
    summary?: string;
  };
  'tool.failed': {
    toolCallId: ToolRunId;
    error: TaalcutError;
    attempts: number;
    durationMs: number;
    usage: ToolUsageTotal;
    /** Set when the side effect may have happened anyway, so a repeat in this run returns this error. */
    idempotencyKey?: string;
  };
  'approval.requested': {
    requestId: string;
    kind: ApprovalKind;
    /** Tool calls this approval covers. Empty for a budget stop before a model call. */
    toolCallIds: string[];
    reason: string;
    limit?: BudgetLimit;
    used?: number;
    max?: number;
    estimate?: { usd: number; tokens: number };
    /** Consent requests: what would leave the device. */
    upload?: UploadScope;
    /** Set when a standing consent answered the request at once: logged, never asked. */
    standingConsentIds?: string[];
    /**
     * P3-B10: Local only answered it at once (the upload's models all run on this Mac): logged, never asked. Also set
     * when the module's chain has no cloud model now (`reason` 'on-device'), and when a tool's pictures are all it
     * would send and no model in the chain sees images (`reason` 'no-pictures', HFW1).
     */
    localOnly?: boolean;
    /** Only a reference's frames, which making a template sends: answered at once, logged, never asked. */
    reference?: boolean;
    /** None of the user's files the call names exists, so none can leave: answered at once, and the tool fails on its own. */
    missingFiles?: string[];
    /** EAR1-R3: consent for a tool that asks every time (`alwaysAsk`): no Always allow, and nothing answers for it. */
    alwaysAsk?: boolean;
    /** Question requests: which question and the skill's suggestion. */
    question?: SkillQuestion;
    suggested?: number;
    /** projectCap requests: the project, what the next step is (i18n key), and cheaper models that fit. */
    projectId?: string;
    labelKey?: string;
    cheaper?: CheaperChoice[];
    /** The tool shows its own decision card (card.sent follows), not the generic approval. */
    customCard?: boolean;
    /** rateLimit requests (G8): the limit every option of a module met. */
    rateLimit?: RateLimitAsk;
  };
  'approval.granted': {
    requestId: string;
    raiseBudgetTo?: RunBudget;
    note?: string;
    /** Consent: the standing consent this grant came from, or the one "Always allow" just created. */
    consentIds?: string[];
    /** A question's answer. */
    answer?: QuestionAnswer;
  };
  /** stale: the user changed what the approval was about; the flow asks again. */
  'approval.denied': { requestId: string; note?: string; reason?: 'stale' };
  'budget.raised': { budget: RunBudget };
  'verify.result': { stepId: string; verdict: 'pass' | 'retry' | 'fail'; reason?: string };
  'checkpoint.saved': { stepId: string };
  /** limit: waiting for a model limit to lift until `until` (G8); external: an MCP run between calls (P3-V4). */
  'run.paused': {
    reason: 'approval' | 'budget' | 'limit' | 'external';
    requestIds: string[];
    until?: number;
  };
  'run.resumed': { after: 'crash' | 'approval' };
  'run.completed': { report: string; did: string[] };
  'run.failed': { error: TaalcutError };
  /** budget: the user stopped at the project's cap. */
  'run.cancelled': { reason?: 'budget' };
}

export type AgentEventType = keyof EventPayloads;

/** Current payload version of every type. Bump a type's version together with an upcaster. */
export const EVENT_VERSIONS: Readonly<Record<AgentEventType, number>> = {
  'run.started': 1,
  'plan.created': 1,
  'plan.updated': 1,
  'step.started': 1,
  'route.chosen': 1,
  'model.requested': 1,
  'model.responded': 1,
  'model.failed': 1,
  'tool.requested': 1,
  'tool.completed': 1,
  'tool.failed': 1,
  'approval.requested': 1,
  'approval.granted': 1,
  'approval.denied': 1,
  'budget.raised': 1,
  'verify.result': 1,
  'checkpoint.saved': 1,
  'run.paused': 1,
  'run.resumed': 1,
  'run.completed': 1,
  'run.failed': 1,
  'run.cancelled': 1,
  ...FLOW_EVENT_VERSIONS,
  ...PHASE3_EVENT_VERSIONS,
};

export const TERMINAL_EVENTS: readonly AgentEventType[] = ['run.completed', 'run.failed', 'run.cancelled'];

type Envelope<T extends AgentEventType> = {
  readonly runId: RunId;
  readonly seq: number;
  readonly type: T;
  readonly v: number;
  readonly at: number;
  readonly payload: EventPayloads[T];
};

export type AgentEvent = { [T in AgentEventType]: Envelope<T> }[AgentEventType];
export type EventOf<T extends AgentEventType> = Envelope<T>;

/** An event before the store numbers it. */
export type NewAgentEvent = {
  [T in AgentEventType]: {
    readonly type: T;
    readonly v: number;
    readonly at: number;
    readonly payload: EventPayloads[T];
  };
}[AgentEventType];

export function newEvent<T extends AgentEventType>(
  type: T,
  payload: EventPayloads[T],
  at: number,
): NewAgentEvent {
  return { type, v: EVENT_VERSIONS[type], at, payload } as NewAgentEvent;
}

const EnvelopeSchema = z.object({
  runId: z.string(),
  seq: z.number().int().nonnegative(),
  type: z.string().min(1),
  v: z.number().int().positive(),
  at: z.number(),
  payload: z.unknown(),
});

/** Lifts a payload from version `from` to `from + 1`, per type. */
export type Upcasters = Readonly<Record<string, Readonly<Record<number, (payload: unknown) => unknown>>>>;

/** None yet: every type is at version 1. */
export const UPCASTERS: Upcasters = {};

/**
 * Validates an envelope read from storage and upcasts its payload. Returns
 * undefined for anything that isn't an envelope (a torn write, say).
 */
export function readEvent(raw: unknown, upcasters: Upcasters = UPCASTERS): AgentEvent | undefined {
  const parsed = EnvelopeSchema.safeParse(raw);
  if (!parsed.success) return undefined;
  const event = parsed.data;
  let { v, payload } = event;
  const steps = upcasters[event.type] ?? {};
  for (let step = steps[v]; step; step = steps[v]) {
    payload = step(payload);
    v += 1;
  }
  return { ...event, v, payload } as AgentEvent;
}
