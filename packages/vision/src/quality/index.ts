// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Frame statistics, shift and the shot quality score. Re-exported whole by the package's entry point
 * (src/index.ts).
 */
export {
  dHash,
  frameStats,
  frameStatsFallback,
  hamming,
  type FrameStats,
  type GrayFrame,
} from './frame-stats';
export { downsample, phaseShift, type Shift } from './shift';
export {
  exposureScore,
  sampleSignals,
  scoreShot,
  type SampleSignals,
  type ShotSignals,
} from './shot-quality';
export {
  analyseCaptionZones,
  relativeLuminance,
  wcagContrast,
  type AnalyseCaptionZonesOptions,
  type NormalizedRect,
} from './caption-clutter';
export {
  detectPseFlashRisk,
  evaluateFrameVisualQa,
  isSkinToneRgb,
  measureHorizonTilt,
  measureSkinToneShare,
  toGrayscaleBuffer,
} from './visual-qa';
