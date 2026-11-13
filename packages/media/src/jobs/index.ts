// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

export {
  encoderChoiceSchema,
  extractFrameJobInputSchema,
  extractFrameJobOutputSchema,
  FRAME_JOB_MAX_BYTES,
  MEDIA_JOB_STAGES,
  MEDIA_STAGE_NOTES,
  mediaExtractFrameJob,
  mediaJobKinds,
  mediaProbeJob,
  mediaSelectEncoderJob,
  probeJobInputSchema,
  selectEncoderJobInputSchema,
  type ExtractFrameJobInput,
  type ExtractFrameJobOutput,
  type ProbeJobInput,
  type SelectEncoderJobInput,
} from './kinds';
export {
  createMediaJobs,
  extractFrameJobHandler,
  probeJobHandler,
  selectEncoderJobHandler,
  type MediaJobDeps,
} from './handlers';
export {
  createDirectJobRunner,
  forwardJobProgress,
  registerJob,
  type JobRegistration,
  type JobRunner,
  type JobRunOptions,
} from './runner';
export {
  mediaConformJob,
  mediaEnforceCacheCapJob,
  mediaMakeFilmstripJob,
  mediaMakePreviewsJob,
  mediaMakeProxyJob,
  mediaMakeThumbnailJob,
  mediaNormaliseJob,
} from './phase2-kinds';
export {
  createMediaIndexStages,
  MEDIA_SKIP,
  MEDIA_STAGE_VERSION,
  PHOTO_SHOT,
  storedPlan,
  storedProxy,
  storedProxyKey,
} from './index-stages';
