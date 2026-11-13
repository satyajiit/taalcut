// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The agent's public types: what createAgent takes and what an Agent does. */
import type {
  ArtifactStore,
  AsyncResult,
  ChatEffort,
  ChatStart,
  CommentBatch,
  EditorContext,
  EditingOwnership,
  ProjectBudgetStore,
  QuestionAnswer,
  ReasoningLevel,
  RunId,
  SelectionChip,
  SkillVerdict,
  TaalcutError,
  Telemetry,
} from '@taalcut/core';
import type { ModelClient, PriceLookup } from '@taalcut/models';
import type { ToolExecutor, ToolRegistry, ToolResultCache } from '@taalcut/tools';
import type { AgentUiEvent, RunStatus } from './cards';
import type { ConsentDeps } from './consent';
import type { LoopSettings, Phase2Context } from './context';
import type { AgentEvent, ApprovalKind, AutonomyLevel, EventPayloads, PlanStep, RunBudget } from './events';
import type { CommandChange } from './flow-watcher';
import type { Phase3Deps } from './phase3-deps';
import type {
  AgentEventSink,
  CommandDispatcher,
  ConsentStore,
  EventLogStore,
  FlowExportFacts,
  FlowProjects,
  ModelCostEstimator,
  RefVersions,
  TraceExporter,
  TraceStore,
  Verifier,
} from './ports';
import type { Soul } from './prompt';
import type { RunLog } from './run-log';
import type { SkillRegistry } from './skills';
import type { Trace } from './trace';

export interface AgentSettings {
  /** Default 'before-render' ("Only before render"). */
  readonly autonomy?: AutonomyLevel;
  /** Default: 200k tokens, US$0.50, 15 minutes of active time. */
  readonly budget?: RunBudget;
  /** Local-only mode: tools that use the internet are refused. */
  readonly localOnly?: boolean;
  readonly loop?: Partial<LoopSettings>;
  /** Price used to estimate a model call before the run has paid for one. Default US$5 per million tokens. */
  readonly usdPerMillionTokens?: number;
  /** The conversation's earlier turns in a run's prompt, in estimated tokens; the oldest go first. Default 8,000. */
  readonly historyTokens?: number;
}

export const DEFAULT_BUDGET: RunBudget = { maxTokens: 200_000, maxUsd: 0.5, maxWallClockMs: 15 * 60_000 };

export interface AgentDeps {
  readonly editing?: EditingOwnership;
  readonly models: ModelClient;
  readonly tools: ToolRegistry;
  readonly log: EventLogStore;
  readonly soul: Soul;
  readonly sink?: AgentEventSink;
  readonly commands?: CommandDispatcher;
  readonly artifacts?: ArtifactStore;
  /** Durable result cache shared across runs. Default: in memory, per agent. */
  readonly toolCache?: ToolResultCache;
  /** Default: every step passes. */
  readonly verifier?: Verifier;
  /** Default: characters / 4, priced at this run's model spend so far. */
  readonly estimator?: ModelCostEstimator;
  /** Receives each run's trace when the run ends. */
  readonly traceExporter?: TraceExporter;
  /** The trace viewer's store: runs and spans are written to it as they open and close. */
  readonly traces?: TraceStore;
  readonly now?: () => number;
  readonly settings?: AgentSettings;
  /** Replaces the tool executor (and so the policy). Replay uses it; production code must not. */
  readonly executor?: ToolExecutor;
  /** Standing upload consents ("Always allow" on a consent card). Default: in memory, so every agent starts asking. */
  readonly consents?: ConsentStore;
  /** Cloud providers a module may send to now (its model chain), shown on the consent card and checked against consents. */
  readonly cloudProviders?: (module: string) => readonly string[];
  /** The app's scratch folder: frames of a reel a breakdown keeps there go to the cloud without a consent card. */
  readonly scratchRoot?: string;
  /** Whether a file an upload names is there: a call naming none of the user's files that exist asks no consent. */
  readonly fileExists?: (file: string) => Promise<boolean>;
  /** EAR1-R3: names (never paths) for media a call names by id, for its consent card (ConsentDeps.uploadNames). */
  readonly uploadNames?: ConsentDeps['uploadNames'];
  /* ---------- Phase 2 (SPEC sections 11–16) ---------- */
  /** The skills (createSkillRegistry over the composed SkillModules). Default: none, so no flows. */
  readonly skills?: SkillRegistry;
  /** Each project's cap and spend (the library's). Without it the project cap isn't checked. */
  readonly budgets?: ProjectBudgetStore;
  /** Prices per module (models' createPriceLookup), for estimates and cheaper options. */
  readonly prices?: PriceLookup;
  /** Alpha telemetry (core's port; it drops everything without consent or under Local only). */
  readonly telemetry?: Telemetry;
  /** A flow's project when the run has none. */
  readonly projects?: FlowProjects;
  /** The exported timeline's slot provenance, for export.completed. Without it that event isn't sent. */
  readonly exports?: FlowExportFacts;
  /** Current versions of what skills handed off: the flow watcher reads them. Without it, no watching. */
  readonly refs?: RefVersions;
  readonly flows?: {
    /** Editor → Reviewer rounds after the first review, per variant. Default 2. */
    readonly maxFixLoops?: number;
    /** A change settles this long before a waiting export approval is closed as stale. Default 1.5 s. */
    readonly staleAfterMs?: number;
    /** No step for this long and a flow's cost is reported as abandoned. Default 24 h. */
    readonly abandonedAfterMs?: number;
  };
  /** Replay only: the logged skill verdicts, in order. */
  readonly replayVerdicts?: () => SkillVerdict | undefined;
  /** Replay only (FIX-CMT): the run's first logged plan, so a comment batch's step replays as it was logged. */
  readonly replayPlan?: readonly PlanStep[];
  /** Replay only (AGT2): the windows the run's routes logged, in order, so each step offers what it offered. */
  readonly replayRouteWindows?: () => number | undefined;
  /** Replay only (AGT2): the head each refused export read, by the export step's id, as its review logged it. */
  readonly replayHeads?: (stepId: string) => number | undefined;
  /* ---------- Phase 3 (SPEC sections 21–29) ---------- */
  readonly phase3?: Phase3Deps;
  /**
   * AGT1: the context window, in tokens, a module's prompt must fit (the smallest model in its chain); a longer
   * prompt is condensed (SPEC "Compaction"). Absent: never condensed.
   */
  readonly contextWindow?: (module: string) => number | undefined;
  /**
   * HFW1: whether every model a module's prompt may go to takes images, so a tool's pictures (ToolSpec `images`) are
   * attached for it (tool-images.ts). Absent or false: the model reads the tool's words.
   */
  readonly seesImages?: (module: string) => boolean;
  /** AGT1: a template's slot count, for the cast board while it asks how many videos. */
  readonly templateSlots?: (templateId: string) => AsyncResult<number | undefined>;
}

export interface StartRequest {
  readonly conversationId: string;
  readonly projectId?: string;
  readonly message: string;
  /**
   * Earlier runs of the conversation, oldest first. Their messages, tool
   * results (cut short, fenced) and answers start this run's prompt, within
   * `settings.historyTokens`; run.started logs them.
   */
  readonly earlierRuns?: readonly RunId[];
  readonly autonomy?: AutonomyLevel;
  readonly budget?: RunBudget;
  readonly localOnly?: boolean;
  /** How hard the model thinks on every turn (the chat's effort). Absent: the model's own level. */
  readonly effort?: ChatEffort;
  /** UX3-AGT: the exact level the chat picked, one of its model's. Replaces `effort` when both are set. */
  readonly reasoning?: ReasoningLevel;
  /** The opening card's choice: the run starts that flow with no planning turn. */
  readonly start?: ChatStart;
  /** What the user pointed at (V3): the first prompt lists them. */
  readonly selections?: readonly SelectionChip[];
  /** EDT1-CMT: the comments the message sent, read by the chat service (CommentBatchPort.open); logged as they are. */
  readonly comments?: CommentBatch;
  /** EDT1: the editor as the user saw it, for a message from its docked chat (Phase3Deps.editor). */
  readonly editorContext?: EditorContext;
}

export interface RunOutcome {
  readonly runId: RunId;
  readonly status: RunStatus;
  readonly report?: string;
  readonly error?: TaalcutError;
  /** What the run is waiting for when paused. */
  readonly pending: readonly { readonly requestId: string; readonly kind: ApprovalKind }[];
}

export interface ApprovalAnswer {
  readonly requestId: string;
  readonly decision: 'approve' | 'deny';
  readonly raiseBudgetTo?: RunBudget;
  readonly note?: string;
  /** On a consent card: "Always allow" for this cloud module, not just this once. */
  readonly remember?: boolean;
  /** A skill's question: the answer (how many variants). */
  readonly answer?: QuestionAnswer;
}

/** What `subscribe` delivers: every event as it is logged, and every UI event (cards, deltas, status). */
export type AgentFeedEvent = AgentEvent | AgentUiEvent;

export interface ReplayReport {
  readonly runId: RunId;
  /** (tool, canonical input) per call, in request order: identical in the log and the replay. */
  readonly toolCalls: readonly { readonly tool: string; readonly input: string }[];
  readonly modelTurns: number;
  /** Model turns whose prompt hashed differently from the log (prompt or soul edited since). */
  readonly promptDrift: number;
  readonly status: RunStatus;
}

export interface Agent {
  /** Server lifecycle hooks, awaited after writes settle and before editing unlocks. */
  onFinalize?(listener: (runId: RunId) => AsyncResult<void>): () => void;
  /** Logs run.started and drives the run in the background. */
  start(request: StartRequest): AsyncResult<RunId>;
  /** start() then wait(). */
  run(request: StartRequest): AsyncResult<RunOutcome>;
  /** Resolves when the run next stops: paused, completed, failed or cancelled. */
  wait(runId: RunId): AsyncResult<RunOutcome>;
  /** Records the user's answer and, when nothing else is pending, continues the run. */
  answer(runId: RunId, answer: ApprovalAnswer): AsyncResult<RunOutcome>;
  /** Stop button. */
  cancel(runId: RunId): AsyncResult<RunOutcome>;
  /** Continues a run after a crash or quit (or a paused run whose answers are all in). */
  resume(runId: RunId): AsyncResult<RunOutcome>;
  /** At start-up: resumes every open run that isn't waiting on the user. Returns their ids. */
  recoverInterrupted(): AsyncResult<RunId[]>;
  /** Exact replay from the log: recorded model turns and tool results, no side effects. */
  replay(runId: RunId): AsyncResult<ReplayReport>;
  trace(runId: RunId): AsyncResult<Trace>;
  events(runId: RunId): AsyncResult<AgentEvent[]>;
  /** Follows every run live. Returns the unsubscribe function. A listener that throws is ignored. */
  subscribe(listener: (event: AgentFeedEvent) => void): () => void;
  /** A command ran (core's command.changed): the flow watcher looks for the user's changes. */
  noteCommand(change: CommandChange): Promise<void>;
  /** Flows with no step for 24 hours report their cost as abandoned (once). Returns their runs. */
  sweepAbandonedFlows(): AsyncResult<RunId[]>;
  /** P3-V4: this agent's runs and dependencies, lent to the external runner (createExternalRunner). */
  external(): ExternalRunHost;
  /** Stops the watcher's timers. */
  close(): void;
}

/* ---------- P3-V4: what an agent lends the external runner (external/host.ts implements it) ---------- */

export interface HeldRun {
  readonly log: RunLog;
  /** Aborted when the agent cancels the run (the chat's stop). */
  readonly signal: AbortSignal;
  /** Ends the hold: the agent's wait on the run settles. */
  release(): void;
}

export interface ExternalRunHost {
  readonly deps: AgentDeps;
  readonly consents: ConsentStore;
  readonly phase2: Phase2Context;
  readonly now: () => number;
  /** Writes run.started for a new run through the agent and holds it. */
  start(runId: RunId, started: EventPayloads['run.started']): AsyncResult<HeldRun>;
  /** Holds a run the log already has (after a restart, or between calls). */
  hold(runId: RunId): AsyncResult<HeldRun>;
  subscribe(listener: (event: AgentFeedEvent) => void): () => void;
}
