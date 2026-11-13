// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Frame and shot descriptions (P1-G7, P2-L9): on device, or the cloud under a standing consent. Re-exported
 * whole by the package's entry point (src/index.ts).
 */
export {
  describeFrame,
  MAX_DESCRIPTION_CHARS,
  SYSTEM_PROMPT,
  wholeSentences,
  type DescribeFrameContext,
  type VisionDeps,
} from './describe-frame';
export {
  DETAIL_MAX_DIMENSION,
  describeFrameInputSchema,
  describeFrameOutputSchema,
  type DescribeFrameInput,
  type DescribeFrameOutput,
  type FrameDetail,
} from './schemas';
export {
  estimateDescribeCost,
  LOW_DETAIL_ANSWER_TOKENS,
  MAX_OUTPUT_TOKENS,
  outputTokensFor,
  placementOf,
  PROMPT_TOKENS,
  visionChain,
  type VisionPlacement,
  type VisionRuntime,
} from './placement';
export { estimateImageTokens, imageTokenFamily, type ImageTokenFamily } from './image-tokens';
export {
  descriptionDocument,
  MOTION_ACTIONS,
  isStill,
  MOTION_ENERGY_FLOOR,
  shotActions,
  type ShotActionsInput,
} from './actions';
export {
  describeAnswerSchema,
  describeShots,
  describeShotsOverPort,
  frameRequestText,
  parseDescription,
  RETRY_TEMPERATURE,
  retryNote,
  SHOT_DESCRIPTION_PROMPT,
  type DescribeShotsContext,
  type DescribeShotsDeps,
  type DescribeShotsInput,
  type DescribeShotsOutput,
  type DescribeShotsOverPortDeps,
} from './describe-shots';
export {
  CONTEXT_PREAMBLE,
  contextPrompt,
  SHOT_CONTEXT_LIMITS,
  shotContextSchema,
  withShotContext,
  type ShotContext,
  type ShotContextView,
} from './shot-context';
