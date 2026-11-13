// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Jobs and the library's indexing stages, the breakdown's jobs included. Re-exported whole by the package's
 * entry point (src/index.ts).
 */
export {
  BREAKDOWN_JOB_STAGES,
  breakdownJobKinds,
  breakdownKey,
  contactSheetJobInputSchema,
  contactSheetJobOutputSchema,
  detectCutsJobInputSchema,
  OCR_LANGUAGES,
  readOverlaysJobInputSchema,
  readOverlaysJobOutputSchema,
  SHEET_MAX_BYTES,
  sheetLayoutSchema,
  visionContactSheetJob,
  visionDetectCutsJob,
  visionReadOverlaysJob,
  type ContactSheetJobInput,
  type ContactSheetJobOutput,
  type DetectCutsJobInput,
  type ReadOverlaysJobInput,
  type ReadOverlaysJobOutput,
  type SheetLayoutInput,
} from './breakdown-kinds';
export { breakdownJobRegistrations } from './breakdown-handlers';
export type { VisionJobDeps } from './deps';
export {
  indexJobKinds,
  VISION_JOB_STAGES,
  visionAnalyzeShotsJob,
  visionDescribeShotsCloudJob,
  visionDescribeShotsJob,
  visionDetectShotsJob,
  visionEmbedAssetJob,
  visionEmbedTextsJob,
  visionGroupDuplicatesJob,
  visionKey,
} from './index-kinds';
export { indexJobRegistrations } from './index-handlers';
export { ocrJobRegistrations } from './ocr-handlers';
export {
  CONTACT_SHEET_RECIPE,
  CONTACT_SHEET_STAGE,
  contactSheetTilesForAsset,
  createContactSheetStage,
  registerIndexContactSheetJob,
  visionIndexContactSheetJob,
  type AnalysedShotForSheet,
  type IndexContactSheetJobInput,
  type IndexContactSheetJobOutput,
  type PlannedSheetTile,
} from './contact-sheet-stage';
export { createLazyVisionJobs, createVisionJobs, visionJobKinds } from './vision-jobs';
export { createVisionIndexStages, visionDuplicatePass, type VisionStageOptions } from './stages';
export { createEmbedStages, EMBED_STAGE_VERSION, framesForShot } from './embed-stages';
export { visionStageVersions, type StageVersionConfig } from './stage-frames';
