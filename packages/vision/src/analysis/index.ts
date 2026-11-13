// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Per-shot analysis (P2-L7, P2-L9, G25 basic): quality, motion and near-duplicates. Re-exported whole by the
 * package's entry point (src/index.ts).
 */
export {
  analyzeShots,
  orientationOf,
  type AnalyzeContext,
  type AnalyzedShot,
  type AnalyzeShotsDeps,
  type AnalyzeShotsInput,
} from './analyze-shots';
export {
  motionPeaks,
  resampleCurve,
  shotProfileSignals,
  type ShotSignalsInput,
} from './profile-signals';
export {
  duplicates,
  groupNearDuplicates,
  type DuplicateCandidate,
  type NearDuplicateGroup,
} from './duplicates';
