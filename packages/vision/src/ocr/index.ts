// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * On-screen text (P2-L6 client): the OCR engines, their routing and reuse, and per-shot reads. Re-exported
 * whole by the package's entry point (src/index.ts).
 */
export {
  OcrEngineToken,
  type OcrCapabilities,
  type OcrEngine,
  type OcrFrame,
  type OcrObservation,
  type OcrPage,
  type OcrQuad,
  type OcrRecognizeOptions,
  type OcrWarmReport,
} from './types';
export { APPLE_VISION_ENGINE, createAppleVisionOcr, type AppleVisionOptions } from './apple-vision';
export { describeWarmUp } from './apple-vision-wire';
export {
  createPaddleDevanagariOcr,
  createPaddleOcr,
  PADDLE_COMPONENT,
  PADDLE_ENGINE,
  PADDLE_LANGUAGES,
  type PaddleOcrOptions,
} from './paddle/engine';
export { PADDLE_DEVANAGARI, PADDLE_LATIN, type PaddleModel } from './paddle/models';
export { planOcrBackends, type OcrBackendPlan, type OcrHost } from './backends';
export { createRoutedOcr, mergePages, type RoutedOcrEngines } from './router';
export { lazyOcrEngine } from './lazy';
export { trackOnScreenText, type TrackInput } from './track';
export { recognizeWithReuse } from './reuse';
export { baseLanguage, boxIou, normaliseText, scriptOf, textSimilarity } from './text';
export { readShotText, servedLanguages, type ShotTextRead, type ShotToRead } from './shot-text';
