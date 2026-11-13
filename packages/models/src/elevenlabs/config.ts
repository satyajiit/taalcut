// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * ElevenLabs ids and limits (SPEC P3.2; ids verified 2026-10-14, `_orch/p3/research/elevenlabs.md`). Which model a
 * voice quality means is kept here rather than as a catalogue `voiceRole` (deviation, SPEC P3.2): a profile's voice
 * chain still decides which of these models may run.
 */
export const ELEVENLABS_PROVIDER = 'elevenlabs';
export const ELEVENLABS_BASE_URL = 'https://api.elevenlabs.io';

export const ELEVENLABS_MODELS = {
  /** Drafts: the fast flagship. */
  draft: 'eleven_v4_turbo',
  /** Finals: the flagship. */
  final: 'eleven_v4',
  music: 'music_v2_5',
  soundEffect: 'eleven_text_to_sound_v2',
} as const;

/** What each text-to-speech model is for; a model missing here serves both qualities. */
export const VOICE_MODEL_ROLES: Readonly<Record<string, 'draft' | 'final' | 'both'>> = {
  eleven_v4: 'final',
  eleven_v4_turbo: 'draft',
};

/** MP3 192 kb/s at 48 kHz needs Creator or above; every plan gets 128 kb/s at 44.1 kHz. */
export const OUTPUT_FORMATS = {
  high: { id: 'mp3_48000_192', sampleRate: 48_000 },
  standard: { id: 'mp3_44100_128', sampleRate: 44_100 },
} as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[keyof typeof OUTPUT_FORMATS];

/** Subscription tiers (prefixes) that may ask for the high format. */
export const HIGH_FORMAT_TIERS = ['creator', 'pro', 'scale', 'business', 'growing_business', 'enterprise'];
/** The tier the Music API refuses (no API concurrency on Free). */
export const FREE_TIER = 'free';

export const ELEVENLABS_LIMITS = {
  /** One script line (core's SynthesisRequest). */
  textCharacters: 5_000,
  sfxText: 500,
  sfxSeconds: { min: 0.5, max: 30 },
  music: {
    chunks: 30,
    chunkText: 200,
    chunkMs: { min: 3_000, max: 120_000 },
    totalMs: { min: 3_000, max: 600_000 },
  },
  /** Pages of the voice list read at most (100 voices each). */
  voicePages: 20,
  voicePageSize: 100,
  /** A failed plan lookup is asked again after this long. */
  tierRetryMs: 10 * 60_000,
} as const;
