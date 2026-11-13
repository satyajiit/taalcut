// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Speech in an asset (P2-L8): segments with word timings. The library stores
 * transcripts (asset profile, full-text search), render builds captions from
 * them (P2-M5), models returns them from the cloud (CloudSpeechToText), and
 * templates derives a reference's `audio.speech` from one. The text is
 * untrusted: it is what someone said.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { timeRangeSchema, type TimeRange } from '../time/time-range';
import { languageTagSchema } from '../templates/template-parts';

/** BCP 47: 'en', 'hi', 'es', 'pt-BR' (the template parts' `languageTagSchema`). */
export type SpokenLanguage = string;
export const spokenLanguageSchema = languageTagSchema;

/** `tts` (P3-B6): words grouped from a speech provider's character timings; confidence 1. */
export const TRANSCRIPT_ENGINES = ['parakeet', 'whisper', 'scribe', 'tts'] as const;
export type TranscriptEngine = (typeof TRANSCRIPT_ENGINES)[number];

export interface TranscriptWord {
  /** As spoken, punctuation attached, NFC. */
  readonly text: string;
  /** Milliseconds (rate 1000/1) on the asset's audio clock, aligned to the video start. */
  readonly range: TimeRange;
  readonly confidence?: number;
}

export interface TranscriptSegment {
  readonly text: string;
  readonly range: TimeRange;
  readonly words: readonly TranscriptWord[];
  readonly language: SpokenLanguage;
  /** Diarisation label when the engine gives one, e.g. 'speaker_0'. */
  readonly speaker?: string;
}

export interface Transcript {
  readonly version: 1;
  /** The language most words are in. */
  readonly language: SpokenLanguage;
  readonly segments: readonly TranscriptSegment[];
  readonly engine: TranscriptEngine;
  /** e.g. 'parakeet-tdt-0.6b-v3-coreml-int8', 'whisper-medium-q5_0', 'scribe_v2'. */
  readonly model: string;
  /** True when nothing left the Mac. */
  readonly local: boolean;
  /** 'native': the engine's word times. 'refined': snapped to onsets. */
  readonly wordTiming: 'native' | 'refined';
}

export const transcriptWordSchema: z.ZodType<TranscriptWord> = z.object({
  text: z.string().min(1).max(200),
  range: timeRangeSchema,
  confidence: z.number().min(0).max(1).optional(),
});

export const transcriptSegmentSchema: z.ZodType<TranscriptSegment> = z.object({
  text: z.string().max(4000),
  range: timeRangeSchema,
  words: z.array(transcriptWordSchema).max(2000),
  language: spokenLanguageSchema,
  speaker: z.string().max(32).optional(),
});

export const transcriptSchema: z.ZodType<Transcript> = z.object({
  version: z.literal(1),
  language: spokenLanguageSchema,
  segments: z.array(transcriptSegmentSchema).max(20_000),
  engine: z.enum(TRANSCRIPT_ENGINES),
  model: z.string().min(1).max(128),
  local: z.boolean(),
  wordTiming: z.enum(['native', 'refined']),
});
