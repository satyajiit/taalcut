// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Breakdown, vision half (P2-T4): cuts with two methods, on-screen text, contact sheets. Re-exported whole by
 * the package's entry point (src/index.ts).
 */
export {
  applyVerdicts,
  detectCuts,
  settleWithoutModel,
  type DetectCutsDeps,
  type DetectCutsOptions,
} from './detect-cuts';
export { readOverlays, type OverlayDeps, type ReadOverlaysOptions } from './overlays';
export {
  frameEmbeddings,
  motionCurve,
  ocrFrames,
  ocrImage,
  sceneScoresOf,
  type MotionSample,
} from './primitives';
export {
  buildContactSheet,
  tileAnnotationsFor,
  type ContactSheet,
  type SheetDeps,
  type SheetLayout,
  type SheetOptions,
  type SheetTile,
} from './contact-sheet';
export {
  breakdownCutSchema,
  CUT_STATUSES,
  cutListSchema,
  frameRatePlainSchema,
  onScreenTextPlainSchema,
  rationalTimePlainSchema,
  timeRangePlainSchema,
  type BreakdownCut,
  type CutList,
  type CutStatus,
  type OnScreenTextPlain,
  type RationalTimePlain,
  type TimeRangePlain,
} from './types';
