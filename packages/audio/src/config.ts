// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Versioned thresholds (SPEC, config v1). Bump `version` when a change would
 * make a stored idempotency key mean something else.
 */
export const AUDIO_CONFIG = {
  version: 1,
  silence: {
    /** silencedetect noise floor. */
    noiseDb: -35,
    minSilenceSec: 0.3,
    /** Integrated loudness at or under this is `silent` (first classify rule). */
    silentLufs: -50,
    minNonSilentRatio: 0.1,
    /** Under this much non-silent audio the asset is silent and is not transcribed. */
    minNonSilentMs: 1000,
  },
  language: {
    /**
     * The reference flow (`audio.measure`, `audio.detectLanguage`): up to three 10 s slices, whisper `-d` on each
     * (not the research note's 30 s cap).
     */
    sliceMs: 10_000,
    maxSlices: 3,
    detectDurationMs: 10_000,
  },
  speech: {
    pauseBreakMs: 600,
    maxSegmentTokens: 512,
    /** A 1–3 word phrase repeated this many times is a whisper loop. */
    loopMinWords: 1,
    loopMaxWords: 3,
    loopRepeats: 4,
    /** Speech ratio ignores words the engine is less sure of than this. */
    confidenceFloor: 0.5,
    /** Onset snapping stays off until golden clips show it lowers word-start error. */
    refineWordOnsets: false,
    refineWindowMs: 120,
  },
  beats: {
    sampleRate: 22_050,
    nFft: 1024,
    hop: 441,
    nMels: 128,
    nFreq: 513,
    fps: 50,
    windowFrames: 1500,
    borderFrames: 6,
    peakPool: 7,
    onsetMatchMs: 70,
    /** bpm is null when (max − min) / median inter-beat interval exceeds this. */
    intervalSpread: 0.3,
    /** Fewer than one downbeat per this many beats is inferred from onset phase. */
    beatsPerDownbeat: 8,
    beatsPerBar: 4,
    lowConfidence: 0.5,
    maxTrackMs: 10 * 60 * 1000,
    model: 'beat-this-1.1.0-onnx-25308706',
  },
  classify: {
    musicScoreMin: 0.6,
    musicSpeechMax: 0.15,
    voiceSpeechMin: 0.3,
    voiceMusicMax: 0.4,
    mixedSpeechMin: 0.15,
    mixedMusicMin: 0.4,
    /** Beat regularity is 1 − CV / this, clamped to 0..1. */
    regularityCv: 0.3,
  },
  models: {
    parakeet: 'parakeet-tdt-0.6b-v3-coreml-int8',
    whisperTiny: 'ggml-tiny.bin',
    whisperSmall: 'whisper-small-q8_0',
    whisperMedium: 'whisper-medium-q5_0',
    scribe: 'scribe_v2',
  },
} as const;

export type HardwareTier = 'minimum' | 'recommended' | 'high';

/**
 * Indexing's language ID (IX-A2): one window of up to `windowMs`, the one with the most voice (whisper pads
 * shorter audio to 30 s, so a shorter one costs the same), trimmed to its voice plus `padMs` either side. The voice
 * scan stops once a window holds `enoughSpeechMs` (test/speech/language-window-length.int.test.ts); less than
 * `minSpeechMs` of voice in the whole asset means nobody speaks. Part of AUDIO_CONFIG's version: a change here
 * changes stored output, so bump that.
 */
export const LANGUAGE_WINDOW = {
  windowMs: 30_000,
  enoughSpeechMs: 10_000,
  minSpeechMs: 1_000,
  padMs: 250,
} as const;
