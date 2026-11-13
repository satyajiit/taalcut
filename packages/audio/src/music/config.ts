// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Generated music and the music pack (SPEC P3.5). Bump `version` when a stored warp would mean something else. */
export const MUSIC_CONFIG = {
  version: 1,
  /** The warped file's recipe in its derived key. */
  recipe: 1,
  sampleRate: 48_000,
  /** Bar ratios outside this regenerate the track; never stretched harder (research: audio-mixing.md). */
  ratio: { min: 0.85, max: 1.15 },
  /** Music runs this far past the timeline's end so the outro can fade. */
  tailMs: 2000,
  /** The API's limits on a v2 composition plan. */
  chunk: { minMs: 3000, maxMs: 120_000, maxChunks: 30, maxTextChars: 200 },
  /** How many leading generated downbeats may be skipped (a pickup the tracker called a bar). */
  pairing: { maxShift: 3, bars: 8 },
  /** A target beat with no tracked beat within this share of a beat interval is missed. */
  grid: { missShare: 0.5, maxMissedShare: 0.05, p95Quantile: 0.95 },
  styles: {
    negative: ['vocals', 'tempo change', 'rubato', 'fade in'],
    maxMoodWords: 6,
  },
  /** The pack's tracks within this share of the asked tempo match. */
  libraryTempoTolerance: 0.06,
  libraryMaxResults: 10,
} as const;
