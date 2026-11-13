// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * @taalcut/vision: Shot detection, OCR, frame captions, embeddings, faces (opt-in).
 *
 * This file is the package's only public entry point. Other packages import
 * from '@taalcut/vision' and never from a path inside src/. See SPEC.md.
 *
 * Each area has its own entry file (`<area>/index.ts`), re-exported whole here,
 * so an area's public names are listed beside its code. Colour and font match
 * re-export only the names other packages use.
 */
export {
  EmbedderUnavailable,
  EmbeddingFailed,
  EmptyDescription,
  FontMatchWithheld,
  FontRenderFailed,
  GradeFailed,
  LookUnavailable,
  ModelOutputInvalid,
  NoLocalVisionModel,
  OcrFailed,
  OcrUnavailable,
  ShotModelFailed,
  SubjectDetectFailed,
  VisionModelMissing,
  SpaceMismatch,
} from './errors';
export { TIERS, VISION_CONFIG, type Tier, type VisionConfig } from './config';

// Frame and shot descriptions (P1-G7, P2-L9).
export * from './describe';
// Agent tools.
export * from './tools';
// Embeddings (P2-L9).
export * from './embed';
// On-screen text (P2-L6 client).
export * from './ocr';
// ONNX Runtime, which the Paddle OCR engine and TransNetV2 run on.
export {
  createOrtRuntime,
  type OnnxRuntime,
  type OnnxSession,
  type OnnxTensor,
  type OrtRuntimeOptions,
} from './onnx/ort';
// Shots in user footage (P2-L7), and their boundaries from TransNetV2 (IX2-C4).
export * from './shots';
export * from './cuts';
// Faces and people without the mac helper (FRM1-SUB).
export * from './subjects';
// Frame and scene passes on media's sampleFrames and analyseVideo.
export * from './media';
// Per-shot analysis (P2-L7, P2-L9, G25 basic) and its quality signals.
export * from './analysis';
export * from './quality';
// Breakdown, vision half (P2-T4).
export * from './breakdown';
// Camera motion, measured (FRM1-MOT).
export * from './motion';
// Jobs and the library's indexing stages.
export * from './jobs';

// Colour match and font match (P3-V17). Templates call measureLook and matchFonts.
export {
  createLookJobs,
  createMatchLookTool,
  createStillLookFrames,
  decodePngRgb,
  frameCountFor,
  gradeLutFromCache,
  MATCH_LOOK_TIMEOUT_MS,
  measureLook,
  reinhardMap,
  sampleSeconds,
  skinToneWeight,
  visionBakeGradeJob,
  visionMeasureLookJob,
  type GradeLutSink,
  type LookFrameSource,
  type LookJobDeps,
  type MatchLookDeps,
  type StillSource,
} from './look';
export { loadCatalogue, matchFonts, toFontMatch, type FontMatchCrop, type FontSuggestionList } from './fonts';
