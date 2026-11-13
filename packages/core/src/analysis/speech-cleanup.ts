// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A talking clip's speech analysis for cleanup (P3-V9): words, speech segments, fillers, pauses, retakes and
 * emphasis. @taalcut/audio's `audio.analyzeSpeech` job writes it as derived JSON (DERIVED_KINDS 'speechCleanup')
 * in the jobs process; @taalcut/timeline reads it in the agent process to plan a cleanup.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { idSchema, type AssetId } from '../basics/ids';
import type { AsyncResult } from '../basics/result';
import { createToken } from '../di/token';
import { languageTagSchema } from '../templates/template-parts';
import { timeRangeSchema } from '../time/time-range';
import { TRANSCRIPT_ENGINES } from './transcript';

const score = z.number().min(0).max(1);
const wordIndex = z.int().nonnegative();
export const RETAKE_KINDS = ['repeat', 'falseStart'] as const;

export const speechCleanupAnalysisSchema = z.object({
  version: z.literal(1),
  assetId: idSchema<'Asset'>(),
  contentHash: z.string().min(1).max(128),
  configVersion: z.int().positive(),
  language: languageTagSchema,
  engine: z.enum(TRANSCRIPT_ENGINES),
  /** The transcript words used, in source time. Untrusted text. */
  words: z
    .array(z.object({ text: z.string().min(1).max(100), range: timeRangeSchema, confidence: score }))
    .max(50_000),
  /** Voice activity segments, unpadded. */
  speech: z.array(timeRangeSchema).max(20_000),
  fillers: z
    .array(
      z.object({
        range: timeRangeSchema,
        /** null: a voiced burst the transcript has no word for. */
        text: z.string().max(40).nullable(),
        wordIndex: wordIndex.nullable(),
        confidence: score,
      }),
    )
    .max(10_000),
  /** Every gap between speech segments of 200 ms or more. */
  pauses: z.array(z.object({ range: timeRangeSchema })).max(20_000),
  retakes: z
    .array(
      z.object({
        earlier: timeRangeSchema,
        later: timeRangeSchema,
        similarity: score,
        kind: z.enum(RETAKE_KINDS),
      }),
    )
    .max(2000),
  emphasis: z.array(z.object({ wordIndex, range: timeRangeSchema, strength: score })).max(5000),
  /** Words that may be fillers ("like", "so"); never removed automatically. */
  ambiguous: z.array(z.object({ wordIndex, range: timeRangeSchema })).max(10_000),
});
export type SpeechCleanupAnalysis = z.output<typeof speechCleanupAnalysisSchema>;

export interface SpeechCleanupSource {
  /** The current analysis of an asset; null when it hasn't been made with the current config. */
  get(assetId: AssetId, signal?: AbortSignal): AsyncResult<SpeechCleanupAnalysis | null>;
}
export const SpeechCleanupSourceToken = createToken<SpeechCleanupSource>('core.speechCleanupSource');

export const ANALYZE_SPEECH_JOB_KIND = 'audio.analyzeSpeech';
export const analyzeSpeechJobInputSchema = z.object({ assetId: idSchema<'Asset'>() });
