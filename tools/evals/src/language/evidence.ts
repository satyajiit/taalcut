// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** What one run of `audio.identifyLanguage` heard on one clip at one crop (predict.ts writes it, score.ts reads it). */
import { z } from 'zod';

const scoreSchema = z.object({ language: z.string(), probability: z.number() });

export const evidenceSchema = z.object({
  id: z.string(),
  /** Seconds of sound heard; 0 is the whole clip. */
  crop: z.number(),
  /** The job failed (its error code); the row counts as unclear. */
  failed: z.string().optional(),
  silent: z.boolean(),
  speechMs: z.number().optional(),
  /** Whisper tiny's likeliest languages on the voice window (BCP 47). Its first is what LIB0 filed the clip under. */
  whisper: z.array(scoreSchema),
  /** The identifier's pieces with all 23 scores; absent when the job left it out (Whisper sure of another language). */
  pieces: z
    .array(
      z.object({
        startMs: z.number(),
        endMs: z.number(),
        scores: z.array(scoreSchema),
        /** Of the clip's later sound: counts toward a mix only. */
        later: z.boolean().optional(),
      }),
    )
    .optional(),
  /** The job's own decision (no prior): the scorer checks it decides the same. */
  job: z
    .object({
      state: z.string(),
      languages: z.array(z.string()),
      confidence: z.number().nullable(),
      source: z.string(),
    })
    .optional(),
  ms: z.number(),
});
export type EvidenceRow = z.infer<typeof evidenceSchema>;
