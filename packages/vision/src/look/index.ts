// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Colour match (P3-V17): measure a look, bake a Reinhard grade into a 17³ cube.
 */
export {
  bt709ToCieLab,
  codeToUnit,
  encodedRoundTrip,
  encodedToRuderman,
  rudermanToEncoded,
  type Encoding,
  type Rgb,
} from './colour-space';
export { parseCube, sampleCube, writeCube, type CubeLut, type WriteCubeOptions } from './cube-writer';
export { ciede2000, meanDeltaE, type CieLab, type DeltaESummary } from './ciede2000';
export { GradeFailed, LookUnavailable } from './errors';
export {
  createLookJobs,
  visionBakeGradeJob,
  visionMeasureLookJob,
  type GradeLutSink,
  type LookFrameSource,
  type LookJobDeps,
} from './grade-jobs';
export { LOOK_POOL_FRAMES, measureLook, type LookFrame, type MeasureLookOptions } from './look-stats';
export {
  createStillLookFrames,
  gradeLutFromCache,
  type StillLookOptions,
  type StillSource,
} from './media-adapter';
export { decodePngPixels, decodePngRgb, type DecodedPng, type DecodedPngPixels } from './png-rgb';
export { frameCountFor, sampleSeconds } from './sample-times';
export {
  createMatchLookTool,
  MATCH_LOOK_TIMEOUT_MS,
  matchLookInputSchema,
  matchLookOutputSchema,
  type MatchLookDeps,
  type MatchLookInput,
  type MatchLookOutput,
} from './look-tools';
export { reinhardMap, skinToneWeight, transferPixel } from './reinhard';
