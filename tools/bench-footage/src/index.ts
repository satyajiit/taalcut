// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The indexing bench's synthetic footage sets (IX-B3): plan, generate, check, read. */
export { ensureFootage, generateSet, type FootageTools, type GenerateOptions } from './generate';
export {
  checkFootage,
  GENERATOR_VERSION,
  MANIFEST_FILE,
  manifestSchema,
  readManifest,
  specHash,
  type ClipManifest,
  type FootageCheck,
  type Manifest,
} from './manifest';
export { refinishSet } from './refinish';
export { planClip, plannedSeconds, type ClipPlan, type CutMark, type ShotPlan } from './plan';
export { FOOTAGE_SETS, footageSet } from './sets/index';
export { FADES_V1 } from './sets/fades-v1';
export { IX_V1 } from './sets/ix-v1';
export type {
  Bed,
  ClipSpec,
  Codec,
  FadeEntry,
  FootageSet,
  ScriptedEntry,
  ScriptedShot,
  SpeechLanguage,
  SpeechSpec,
} from './sets/types';
export { runWatched, sampleOnce, StallError, stallReport, type StallWatch } from './stall';
export { bundledFfmpeg, FFMPEG_STALL_MS, systemTools } from './tools';
