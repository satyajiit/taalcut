// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What agent memory plugs into a run (LRN1-MEM, SPEC section 33): the library's ranker, the cloud switch and where
 * the prompts go, read once when the run starts. What a run recalled is logged in run.started (`memory`), so a
 * resume or a replay builds the same prompt without asking again, and a memory changed mid-run waits for the next.
 */
import type {
  AsyncResult,
  MemoryItemView,
  MemoryPromptUse,
  MemoryScope,
  MemorySource,
  ModelModuleId,
  ProjectId,
  TemplateId,
} from '@taalcut/core';
import type { ProductMemoryContext } from '../products/knowledge';

/** One item as the library's ranker returns it (createMemoryRanker), structurally. */
export interface RankedMemoryItem {
  readonly item: MemoryItemView;
  readonly score: number;
  readonly matchedBy: readonly string[];
}

export interface MemoryRankerPort {
  rank(request: {
    readonly scopes: readonly MemoryScope[];
    readonly query: string;
    readonly k: number;
    readonly signal?: AbortSignal;
  }): AsyncResult<RankedMemoryItem[]>;
}

export interface MemoryRecallDeps {
  readonly productContext?: (input: {
    projectId?: string;
    query: string;
  }) => AsyncResult<ProductMemoryContext | null>;
  readonly ranker: MemoryRankerPort;
  /** MEMORY_CLOUD_PROMPTS_SETTING now. */
  readonly cloudPrompts: () => AsyncResult<boolean>;
  /**
   * Whether a prompt to this model module may leave the Mac now: its chain has a cloud model (privacy's
   * `runsOn` is cloud or both). Local only is applied by the caller, not here.
   */
  readonly leavesDevice: (module: ModelModuleId) => boolean;
  /** The templates the project's timelines are made from, newest first. */
  readonly projectTemplates?: (projectId: ProjectId) => AsyncResult<readonly TemplateId[]>;
  /** Items at most. Default MEMORY_RECALL_K. */
  readonly k?: number;
  /** The block's size in estimated tokens (characters / 4). Default MEMORY_PROMPT_TOKENS. */
  readonly maxTokens?: number;
  /**
   * LRN1-CTX: the smallest context window, in tokens, among the models a prompt to this module may go to (its
   * chain), or undefined when none is known. The block takes at most MEMORY_WINDOW_SHARE of the smallest one.
   */
  readonly contextWindow?: (module: ModelModuleId) => number | undefined;
  /** Replay: what the run logged (loggedPhase3). Nothing is read; the replayed prompt is the original. */
  readonly replay?: RecalledMemory;
}

/** One recalled item, as logged: what the prompt shows and nothing more. */
export interface RecalledMemoryItem {
  readonly id: string;
  readonly scope: MemoryScope;
  /** The project's or template's name (user content); null in the user scope. */
  readonly scopeName: string | null;
  readonly source: MemorySource;
  readonly text: string;
  /** Epoch ms of its last change. */
  readonly updatedAt: number;
  /** What kind of learned item it is ('what-worked', 'casting-weights'), if any. */
  readonly learned?: string;
}

/** run.started's `memory`: what the run's prompts carry, or why they carry none. */
export interface RecalledMemory {
  readonly product?: ProductMemoryContext;
  readonly use: MemoryPromptUse;
  readonly items: readonly RecalledMemoryItem[];
  /** Items ranked but left out to fit the token budget. */
  readonly trimmed: number;
  /** The error code when the store or a setting couldn't be read: the run goes on without memory. */
  readonly failed?: string;
}
