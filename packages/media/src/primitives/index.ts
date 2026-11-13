// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

export { sampleFrames, type SampledFrame, type SampleFramesOptions } from './sample-frames';
export { analyseVideo, type AnalyseOptions, type AnalyseResult } from './analyse';
export { measureLoudness, type LoudnessOptions } from './loudness';
export { compareFrames, type CompareOptions, type CompareResult } from './compare';
export { extractAudio, type ExtractAudioOptions } from './extract-audio';
export { contactSheet, type ContactTile, type ContactSheetOptions } from './contact-sheet';
export {
  parseBlackdetect,
  parseEbur128,
  parseFreezedetect,
  parseSceneScores,
  parseSsim,
  type LoudnessReading,
  type SceneScore,
  type SsimReading,
  type TimeInterval,
} from './parsers';
export { filterPathArg } from './filter-path';
export {
  annotateRgbTile,
  drawRgbAnnotatedBox,
  drawRgbPillBadge,
  drawRgbRect,
  drawRgbWaveformStrip,
  type RgbTriplet,
} from './annotate-rgb';
export { buildDspFilterChain, buildDspFilterSteps, dspNodeToFilter, presetDspNodes } from './dsp-filter';
