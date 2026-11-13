// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Ports the agent needs that core doesn't have yet (the core owner is adding
 * an EventLogStore port, DI tokens, the event bus and the command bus). They
 * are shaped like packages/agent/SPEC.md so switching to core's versions is a
 * rename. Everything here is an interface; implementations come by DI.
 */
import type {
  AsyncResult,
  ConversationId,
  RunStatus as LogRunStatus,
  MessageId,
  ProjectId,
  RunId,
  ToolRunId,
  ToolSideEffect,
} from '@taalcut/core';
import type { AgentEvent, NewAgentEvent } from './events';
import type { AgentUiEvent } from './cards';
import type { SpanKind, Trace, TraceGapReason } from './trace';

/** Append-only per-run event log (library implements it on the agent_events table). */
export interface EventLogStore {
  /**
   * Appends all events or none, numbering them from `expectedSeq`. Fails with
   * agent.log_conflict if `expectedSeq` isn't the next free seq for the run.
   * Returns the seq of the last event written.
   */
  append(runId: RunId, expectedSeq: number, events: readonly NewAgentEvent[]): AsyncResult<number>;
  /** Events in seq order, from `fromSeq` (default 0). An unknown run reads as an empty list. */
  read(runId: RunId, fromSeq?: number): AsyncResult<AgentEvent[]>;
  /** Runs with no run.completed, run.failed or run.cancelled; late file receipts do not reopen them. */
  openRuns(): AsyncResult<RunId[]>;
}

/** UI-facing events: stream deltas, run status and card payloads. Goes to core's event bus. */
export interface AgentEventSink {
  emit(event: AgentUiEvent): void;
}

export interface CommandDispatchMeta {
  /** 'mcp': a call an external agent made over MCP (P3-V4); its audit row names `actor`. */
  readonly source: 'agent' | 'mcp';
  /** Who acted, e.g. 'mcp:<sessionId>'. Absent for the built-in agent ('agent:<runId>'). */
  readonly actor?: string;
  readonly runId?: RunId;
  readonly toolCallId: ToolRunId;
  readonly tool: string;
  /** The bus must refuse to apply a command twice with the same key (crash between commit and log). */
  readonly idempotencyKey?: string;
  /** Aborted on the tool's timeout and on cancel: a command not yet applied should be dropped. */
  readonly signal?: AbortSignal;
}

/** Core's command bus, as the agent needs it. Tools reach it through the tool executor. */
export interface CommandDispatcher {
  dispatch(command: string, payload: unknown, meta: CommandDispatchMeta): AsyncResult<unknown>;
}

/**
 * A standing "Always allow" for one cloud module to send the user's media
 * (PRD G9). Each upload under it is still logged as its own approval.
 */
export interface UploadConsent {
  readonly id: string;
  /** The cloud module, or `module.kind` for a kind of media with consents of its own (`consentKey`, EAR1-I5). */
  readonly module: string;
  /** Providers it covers. A provider added to the module's chain later needs a new consent. */
  readonly providers: readonly string[];
  readonly grantedAt: number;
}

/** Where standing consents live: Settings in the app (library's settings table), memory in tests. */
export interface ConsentStore {
  get(module: string): Promise<UploadConsent | undefined>;
  grant(consent: UploadConsent): Promise<void>;
  /** Every standing consent. */
  list(): Promise<UploadConsent[]>;
  /** Takes the module's consent back; false if it had none. Its next upload asks again. */
  revoke(module: string): Promise<boolean>;
}

/* ---------- Conversations: what the chat service reads and writes ---------- */
/*
 * A structural subset of library's ConversationStore
 * (createLibraryPorts(db).conversations), so the composition root passes
 * that one as is.
 */

/** One conversation in the chat sidebar. */
export interface ConversationSummary {
  readonly id: ConversationId;
  /** Empty until the conversation has one (the chat names it after the first message). */
  readonly title: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  /** The project the conversation works on, once it has one. */
  readonly projectId?: ProjectId | null;
}

export type StoredMessagePart =
  { readonly type: 'text'; readonly text: string } | { readonly type: 'card'; readonly cardId: string };

/** What the user said, or what the agent answered (one message per model turn that wrote text). */
export interface StoredMessage {
  readonly id: MessageId;
  readonly role: 'user' | 'assistant' | 'system';
  readonly parts: readonly StoredMessagePart[];
  /** The run the user's message started, or the assistant's message came from. */
  readonly runId: RunId | null;
  /** Epoch ms. */
  readonly createdAt: number;
}

export interface StoredConversation {
  readonly conversation: ConversationSummary;
  /** Oldest first. */
  readonly messages: readonly StoredMessage[];
  /** Runs started in this conversation. */
  readonly runs: readonly { readonly runId: RunId }[];
}

export interface ConversationStore {
  create(input: {
    readonly id?: ConversationId;
    readonly title?: string | null;
  }): AsyncResult<ConversationSummary>;
  /** Newest first. */
  list(): AsyncResult<ConversationSummary[]>;
  /** core.not_found for an id never created. */
  get(id: ConversationId): AsyncResult<StoredConversation>;
  /** Creates the conversation if needed and moves its updatedAt. Appending an id again changes nothing. */
  appendMessage(input: {
    readonly conversationId: ConversationId;
    readonly role: 'user' | 'assistant';
    readonly parts: readonly { readonly type: 'text'; readonly text: string }[];
    readonly runId?: RunId | null;
    readonly id?: MessageId;
  }): AsyncResult<unknown>;
  linkRun(conversationId: ConversationId, runId: RunId): AsyncResult<void>;
  /** A new title (the user's, or the one the chat service asks a model for after the first exchange). */
  rename(id: ConversationId, title: string): AsyncResult<unknown>;
}

/** Optional OpenTelemetry (or any) export of finished traces. No OTel dependency here. */
export interface TraceExporter {
  export(trace: Trace): Promise<void>;
}

/* ---------- Traces: what the developer trace viewer reads ---------- */
/*
 * A structural subset of library's TraceStore (createLibraryPorts(db).traces),
 * so the composition root passes that one as is. Arrays are mutable to match
 * its zod-inferred input types.
 */

/** One span as the store keeps it. Measured attributes are named fields; open spans are 'running'. */
export interface TraceSpanRecord {
  spanId: string;
  parentSpanId: string | null;
  kind: SpanKind;
  /** run: the user's request; step: the plan step; model: 'provider/model'; tool: the tool; approval: the reason. */
  name: string;
  startedAt: number;
  /** Absent while the span is open. */
  endedAt?: number;
  status: 'running' | 'ok' | 'error' | 'cancelled';
  provider?: string;
  model?: string;
  stopReason?: 'end' | 'tool_calls' | 'max_tokens';
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  costUsd?: number;
  tool?: string;
  version?: string;
  sideEffect?: ToolSideEffect;
  attempts?: number;
  cacheHit?: boolean;
  deduplicated?: boolean;
  errorCode?: string;
  /** Point-in-time events (retries, fallbacks). */
  events: { name: 'retry' | 'fallback'; at: number; detail?: string }[];
}

/** A run's header, recorded when it starts, when its status changes and when it ends. */
export interface TraceRunRecord {
  runId: RunId;
  conversationId: ConversationId | null;
  status: LogRunStatus;
  /** The user's request. */
  message: string;
  startedAt: number;
  endedAt?: number;
  /** Set when the run ends: what its trace is missing (empty when complete). */
  gaps?: { spanId?: string; seq: number; reason: TraceGapReason }[];
}

export interface TraceStore {
  recordRun(run: TraceRunRecord): AsyncResult<void>;
  recordSpan(runId: RunId, span: TraceSpanRecord): AsyncResult<void>;
}

export interface ModelCostEstimate {
  readonly tokens: number;
  readonly usd: number;
}

/**
 * Estimates a model call before it is made, for the budget check. The default
 * counts characters (4 per token) and prices tokens at what this run has paid
 * so far, or at a configured rate before the first call.
 */
export interface ModelCostEstimator {
  estimate(request: {
    readonly promptChars: number;
    readonly expectedOutputTokens: number;
  }): ModelCostEstimate;
}

/** Step verification hook (PRD 7.2 "Verification"). Phase 2 skills add second-method checks. */
export interface Verifier {
  verify(step: {
    readonly runId: RunId;
    readonly stepId: string;
    readonly text: string;
    /** The model's closing text for the step. */
    readonly summary: string;
  }): Promise<VerifyVerdict>;
}

export type VerifyVerdict =
  | { readonly verdict: 'pass' }
  | { readonly verdict: 'retry'; readonly reason: string }
  | { readonly verdict: 'fail'; readonly reason: string };

/* ---------- Phase 2: flows ---------- */

/** Where a flow's project comes from when the run has none (the library's projects, through the command bus). */
export interface FlowProjects {
  /** The conversation's project; one is created (and the conversation linked to it) if it has none. */
  forConversation(conversationId: string, input: { readonly name: string }): AsyncResult<string>;
}

/**
 * The current version of a stored thing a skill handed off (a template's
 * version, a timeline's revision, a render's round), for the flow watcher.
 * Undefined: it no longer exists.
 */
export interface RefVersions {
  version(ref: { readonly entity: string; readonly id: string }): AsyncResult<number | undefined>;
}

/**
 * What export.completed needs beyond the export's own output (gate criteria 1
 * and 2): the exported timeline's slot provenance and whether this is the
 * user's first export. The desktop reads them from the library's stores.
 */
export interface ExportFacts {
  readonly firstExport: boolean;
  readonly slots: number;
  /** Slots still filled by the Librarian's pick. */
  readonly slotsKeptAi: number;
  /** Slots the user swapped (the cast board, timeline.swapClip). */
  readonly slotsSwappedByUser: number;
  /** The clips no longer play in the cast's slot order. */
  readonly orderChanged: boolean;
  /** The timeline uses an edited version of its reference template. */
  readonly breakdownEdited: boolean;
}

export interface FlowExportFacts {
  /** Undefined: not known (no export.completed is sent). Never throws into a run. */
  facts(input: {
    readonly projectId: string;
    readonly timelineId: string;
    readonly renderId: string;
  }): Promise<ExportFacts | undefined>;
}
