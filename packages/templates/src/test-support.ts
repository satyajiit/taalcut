// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Test-only entry ('@taalcut/templates/test-support'): fakes and stand-ins
 * other packages' tests (and tools/evals' synthetic suite) may use. Never
 * imported by app or package code (dependency-cruiser).
 */
export {
  createMemoryTemplateStore,
  ORPHAN_ASSET_MS,
  type MemoryTemplateStore,
} from './testing/memory-template-store';
export {
  createFfmpegAnalysers,
  type FfmpegAnalyserVideo,
  type FfmpegBinaryPaths,
} from './testing/ffmpeg-analysers';
export {
  DEFAULT_REEL_ENCODER,
  SYNTHETIC_REELS,
  syntheticLabels,
  syntheticReelArgs,
  type SyntheticBox,
  type SyntheticLabels,
  type SyntheticReelSpec,
  type SyntheticShot,
} from './testing/synthetic-reel';
export { runProcess, type ProcessResult } from './testing/run-process';
export {
  createMemoryTemplateMediaStore,
  type MemoryTemplateMediaStore,
} from './testing/memory-template-media';
export { createMemoryVectorIndex, type MemoryVectorIndex } from './vectors/testing/memory-vector-index';
