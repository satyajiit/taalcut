// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The analysis pass (IX-D2), its segments (IX-D7), its scene files and its small RGB stream (IX2-C3): media's
 * barrel re-exports these.
 */
export {
  runAnalysisPass,
  type AnalysisPassOptions,
  type AnalysisPassResult,
  type PassFrame,
  type PassFrameSet,
  type SceneSample as PassSceneSample,
} from './run-pass';
export { lineFilter, parseSceneFile, type SceneFrame } from './scene-file';
export type { RgbBatch, RgbStream } from './rgb-stream';
export {
  lcm,
  passSegments,
  runSegmentedPass,
  SEGMENT_MIN_SECONDS,
  SEGMENT_SECONDS,
  stitchIntervals,
  type PassSegment,
  type SegmentedPassOptions,
  type SegmentRgbStream,
} from './segments';
