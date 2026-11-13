// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Camera motion, measured (FRM1-MOT): the background's similarity between frame pairs and a shot's move from them.
 * Re-exported whole by the package's entry point (src/index.ts).
 */
export {
  classifyShot,
  confidenceOf,
  decideMotion,
  shotFeatures,
  type MotionThresholds,
  type MotionPair,
  type ShotFeatures,
  type ShotMeasure,
} from './classify';
export { MOTION_CONFIG, type MotionConfig } from './config';
export {
  boxShift,
  cameraMotion,
  stepIn,
  type CameraMotionOptions,
  type CameraMotionResult,
  type ShotPairs,
  type ShotRange,
} from './estimate';
export { pairMotion, type PairMotion, type ShareBox } from './pair';
export { cameraMeasureOf } from './measure';
