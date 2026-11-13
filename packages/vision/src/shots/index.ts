// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Shots in user footage (P2-L7): which detector decides, scdet with the embedding check, or the model. Re-
 * exported whole by the package's entry point (src/index.ts).
 */
export {
  decide,
  detectShots,
  shotFallback,
  mergeShortShots,
  shotsFromCuts,
  type DetectShotsDeps,
  type DetectShotsResult,
  type ShotCut,
  type ShotsContext,
} from './detect-shots';
export { frameVectors, locate, pairDistances, type Located } from './confirm';
export { modelShots, streamEvery } from './model-shots';
export { scdetShots } from './scdet-shots';
