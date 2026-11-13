// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Frame and scene passes on media's sampleFrames and analyseVideo (vision's grid terms over the plan). Re-
 * exported whole by the package's entry point (src/index.ts).
 */
export {
  fitLongSide,
  probeSource,
  sampleFrames,
  type FrameFormat,
  type SampledFrame,
  type SampleOptions,
  type VideoSource,
} from './frames';
export { sceneFallback, sceneScores, type SceneOptions, type SceneSample } from './scene';
export { encodePng } from './png';
export { composeGrid, encodeJpeg, type EncodeJpegOptions, type RgbImage } from './sheet';
