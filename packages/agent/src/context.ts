// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** What one run's loop works with. Built by createAgent for each run it drives. */
import type { ArtifactStore, AsyncResult, ProjectBudgetStore, SkillVerdict, Telemetry } from '@taalcut/core';
import type { ModelClient, PriceLookup, ReasoningLevel } from '@taalcut/models';
import type { ToolExecutor, ToolRegistry } from '@taalcut/tools';
import type { PlanStep } from './events';
import type { Phase3Deps } from './phase3-deps';
import type {
  AgentEventSink,
  FlowExportFacts,
  FlowProjects,
  ModelCostEstimator,
  RefVersions,
  Verifier,
} from './ports';
import type { Soul } from './prompt';
import type { RunLog } from './run-log';
import type { SkillRegistry } from './skills';

export interface LoopSettings {
  /** Model turns allowed in one plan step before the run fails. Default 10. */
  readonly maxTurnsPerStep: number;
  /** Model turns allowed in the whole run. Default 40. */
  readonly maxTurns: number;
  /** Local read tools that may run at once. Default 4. */
  readonly maxParallel: number;
  /** Cloud and paid read tools that may run at once. Default 2. */
  readonly maxParallelCloud: number;
  /** Verification retries per step before it fails. Default 2. */
  readonly maxVerifyRetries: number;
  /**
   * A skill step's model turns in a row that call no tool before the step ends (BRK1-MAKE: the text loop).
   * Default 3: the first is nudged, the third ends the step.
   */
  readonly maxTextTurns?: number;
  /** FIX-RUN: waits before each retry of a dropped model call, in ms; its length is the number of retries. */
  readonly modelRetryDelaysMs?: readonly number[];
  /** Output tokens assumed for a model call's budget estimate. Default 1000. */
  readonly expectedOutputTokens: number;
  readonly temperature?: number;
  readonly reasoning?: ReasoningLevel;
  readonly maxOutputTokens?: number;
}

export const DEFAULT_LOOP_SETTINGS: LoopSettings = {
  maxTurnsPerStep: 10,
  maxTurns: 40,
  maxParallel: 4,
  maxParallelCloud: 2,
  maxVerifyRetries: 2,
  maxTextTurns: 3,
  expectedOutputTokens: 1000,
};

export interface RunContext {
  readonly log: RunLog;
  readonly signal: AbortSignal;
  readonly models: ModelClient;
  readonly registry: ToolRegistry;
  readonly executor: ToolExecutor;
  readonly systemPrompt: string;
  readonly artifacts?: ArtifactStore;
  readonly verifier: Verifier;
  readonly estimator: ModelCostEstimator;
  readonly sink: AgentEventSink;
  readonly now: () => number;
  readonly settings: LoopSettings;
  /** Idempotency keys the executor used, by tool call id, so tool.completed can record them. */
  readonly idempotencyKeys: Map<string, string>;
  readonly soul: Soul;
  readonly skills: SkillRegistry;
  readonly phase2: Phase2Context;
  /** Phase 3's features (phase3-deps.ts); each absent one behaves as Phase 2. */
  readonly phase3: Phase3Deps;
  /**
   * AGT1: the context window, in tokens, of the models a module's prompt may go to (the smallest in its chain); the
   * prompt is condensed to fit it (context/compaction.ts). Undefined: nothing is condensed.
   */
  readonly contextWindow?: (module: string) => number | undefined;
  /**
   * HFW1: whether every model a module's prompt may go to takes images, so a tool's pictures (ToolSpec `images`) are
   * attached for it (tool-images.ts). Absent or false: the model reads the tool's words.
   */
  readonly seesImages?: (module: string) => boolean;
  /** AGT1: a template's slot count (the cast board's question). */
  readonly templateSlots?: (templateId: string) => AsyncResult<number | undefined>;
}

/** What skills, flows and costs need (SPEC sections 11–16). Everything optional degrades to "not there". */
export interface Phase2Context {
  readonly budgets?: ProjectBudgetStore;
  readonly prices?: PriceLookup;
  readonly telemetry: Telemetry;
  readonly projects?: FlowProjects;
  /** For export.completed; without it the event isn't sent. */
  readonly exports?: FlowExportFacts;
  /** Editor (or Maker) → Reviewer fix rounds per variant; absent (AGT2): the review's window's (iteration-budget.ts). */
  readonly maxFixLoops?: number;
  /** AGT2: where a refused export re-reads its timeline's head (export-conflicts.ts). Absent: it reads none. */
  readonly refs?: RefVersions;
  /** Replay: the logged skill verdicts, in order; no cards, estimates, cap checks or telemetry. */
  readonly replay?: {
    nextVerdict(): SkillVerdict | undefined;
    /** AGT2: the logged route windows, in order (route.chosen `window`), so each step's offer replays alike. */
    nextRouteWindow?(): number | undefined;
    /** AGT2: the head a refused export's step read, as its review logged it (FlowStepInfo `revision`). */
    headAfter?(stepId: string): number | undefined;
    /** FIX-CMT: the run's first logged plan (a comment batch's step as it was logged). */
    readonly plan?: readonly PlanStep[];
  };
}
