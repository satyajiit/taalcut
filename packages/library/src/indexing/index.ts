// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The indexing pipeline (P2-L13): stage rows, the pipeline, status, timings, the router and re-index; the two
 * finish lines per asset and the registered stages (round IX).
 */
export { applyStageResult } from './apply-result';
export { createCacheHolds, OFFLINE_HASHES_MAX, offlineContentHashes, type CacheHolds } from './cache-holds';
export { applyDuplicateGroups, duplicatePassRequest, duplicateShotViews } from './duplicates';
export { createEvictedFiles, FILE_EVICTED, type EvictedFiles } from './evicted-files';
export {
  createIndexingPipeline,
  type IndexingPipeline,
  type IndexingPipelineDeps,
} from './indexing-pipeline';
export {
  createMilestoneTracker,
  type MilestoneSweep,
  type MilestoneTracker,
  type MilestoneTrackerDeps,
} from './milestones';
export { createInvalidation, type Invalidation } from './invalidation';
export { INDEXING_PAUSED_SETTING, isIndexingPaused, readImportStatus } from './paused';
export { OPEN_CLIPS_MAX, OPEN_CLIPS_SETTING, openClips, saveOpenClips } from './open-clips';
export { createPipelineCore, type PipelineCore } from './pipeline';
export { providedSkip, skippingProvidedSpeech, TRANSCRIPT_PROVIDED } from './provided-transcript';
export {
  createReindexCommand,
  REINDEX_ASSETS,
  reindexAssets,
  type ReindexCommandDeps,
} from './reindex-command';
export { indexingRouter } from './router';
// LIB1-LANG: correcting a clip's spoken language.
export {
  createSetAssetLanguageCommand,
  LANGUAGE_STAGES,
  SET_ASSET_LANGUAGE,
  setAssetLanguage,
  type SetAssetLanguageDeps,
} from './set-asset-language';
export {
  createStageRows,
  HASH_STAGE,
  MAX_OUTPUT_BYTES,
  MODEL_MISSING,
  ORIGINAL_OFFLINE,
  type RunnableStage,
  type StagePlan,
  type StageRow,
  type StageRows,
} from './stage-rows';
export { checkStageReads, optionalReadersOf, readersOf } from './stage-reads';
export { orderStages, stagePlan } from './stage-plan';
export { milestoneOf, readStageRegistry, registerIndexStages, type StageRegistry } from './stage-registry';
export { DEFAULT_STAGE_ORDER, indexingStatus, stageDurations, type StatusOptions } from './status';
export { pipelineTimings, type PipelineTimings, type StageTiming } from './timings';
export { buildAssetIndexView, presentOriginal, type ViewOutcome } from './view';
