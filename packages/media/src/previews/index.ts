// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

export { makePreviews, type PreviewOutputs, type PreviewResult } from './make-previews';
export { makeFilmstrip, type FilmstripOptions, type FilmstripResult } from './make-filmstrip';
export { makeThumbnail, THUMB_LONG_SIDE, type ThumbnailOptions } from './thumbnail';
export { MIN_KEYFRAME_CANDIDATES, POSTER_FRACTIONS, type PosterSource } from './poster-frames';
export {
  peaksFromSpeechPcm,
  SPEECH_PCM_RATE,
  type SpeechPcmFile,
  type SpeechPcmPort,
} from './speech-pcm-port';
export { FILMSTRIP_TILE_HEIGHT, filmstripFrameCount, filmstripLayout, type FilmstripLayout, type FilmstripTile } from './filmstrip';
export { summariseWaveformPeaks, WAVEFORM_SUMMARY_MAX } from './peaks';
export {
  keyframeTileSpacing,
  spriteRead,
  type SpriteOptions,
  type SpriteRead,
  type SpriteSource,
} from './filmstrip-sprite';
