// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The speech-cleanup analysis (SPEC P3.7). `configVersion` is part of the stored analysis and its key: bump it
 * whenever a change here would find different fillers, pauses, retakes or emphasis. The thresholds marked
 * "tuned on the labels" are starting points until the 10 labelled talking-head clips (human input) exist.
 */
export const CLEANUP_AUDIO_CONFIG = {
  configVersion: 1,
  /** The derived JSON's recipe. */
  recipe: 1,
  vad: {
    model: 'silero-vad-6.2.3',
    sampleRate: 16_000,
    /** 512 samples (32 ms) a window, with the 64-sample context the v6 graph expects. */
    window: 512,
    context: 64,
    threshold: 0.5,
    /** Speech ends when the probability falls under this (Silero's threshold − 0.15). */
    negThreshold: 0.35,
    /** Silence shorter than this doesn't split speech; at or under the pause floor so no pause is glued. */
    minSilenceMs: 100,
  },
  /** Every gap between speech segments this long or longer is a pause (the threshold setting's minimum). */
  minPauseMs: 200,
  filler: {
    /** A filler's voiced island lasts this long (research: 80–400 ms). */
    minMs: 80,
    maxMs: 400,
    /** An island with no word between two kept words, shorter than this, is a filler candidate (tight: "a", "I"). */
    untranscribedMaxMs: 250,
    /** A word overlapping an island by less than this doesn't own it. */
    overlapMs: 20,
  },
  /** Words this far apart start a new phrase for the retake pass. */
  phraseGapMs: 300,
  /** Tuned on the labels: start 0.8. */
  retakeSimilarity: 0.8,
  /** A false start is at least this many characters (so "I" before "I think" isn't one). */
  falseStartMinChars: 6,
  emphasis: {
    /** Tuned on the labels: a word's peak RMS over the clip's median word peak. */
    ratio: 1.6,
    minGapMs: 4000,
    skipStartMs: 500,
    frameMs: 32,
  },
} as const;
