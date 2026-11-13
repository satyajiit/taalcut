// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Agent memory (LRN1-MEM, SPEC section 33): recall into the prompt, the memory tools, Settings' service, what worked. */
export type {
  MemoryRankerPort,
  MemoryRecallDeps,
  RankedMemoryItem,
  RecalledMemory,
  RecalledMemoryItem,
} from './memory-port';
export {
  fitMemory,
  MEMORY_PROMPT_TOKENS,
  MEMORY_RECALL_K,
  MEMORY_WINDOW_SHARE,
  memoryTokenBudget,
  memoryUse,
  recallMemory,
  runScopes,
} from './recall';
export { MEMORY_HEADING, memoryBlock, withMemory } from './memory-block';
export {
  memoryRunFacts,
  memoryToolModule,
  RECALL_TOOL,
  REMEMBER_TOOL,
  type MemoryRunFacts,
  type MemoryToolDeps,
} from './memory-tools';
export {
  createMemoryService,
  promptPlan,
  promptUse,
  type MemoryServiceDeps,
  type PromptPlan,
} from './memory-service';
export { renderFacts, type RenderFacts, type RenderFactsDeps, type RenderFactsRecord } from './render-facts';
export {
  createWhatWorkedRecorder,
  WHAT_WORKED_SEEN_SETTING,
  whatWorkedText,
  type WhatWorkedDeps,
  type WhatWorkedOutcome,
  type WhatWorkedRecorder,
} from './what-worked';
