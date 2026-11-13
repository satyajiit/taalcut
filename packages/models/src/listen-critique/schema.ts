// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-X1: `audio.cloudCritique`'s input and output. The output keeps earshot's critique shape (llm.py `normalize`),
 * with every time a RationalTime in milliseconds from the start of the source (file time), as approximate as the
 * model's: an opinion, not a measurement. Times are `rationalTimeJsonSchema`: the output is exported to JSON Schema
 * for the model, which can't carry frameRateSchema's transform.
 */
import { z } from 'zod';
import { rationalTimeJsonSchema, timeRangeSchema, ulidSchema } from '@taalcut/core';

/** The whole call: encode, listen here, upload, answer. Upstream waits up to 600 s; a short film needs far less. */
export const CLOUD_CRITIQUE_TIMEOUT_MS = 120_000;
/** Longer sound is trimmed to this (upstream: 600 s): a short film fits, and the answer comes back in time. */
export const CLOUD_CRITIQUE_MAX_SECONDS = 180;
/** What the hosted model hears: mono, small (upstream sends 64 kbps mono MP3; FFmpeg here has no LAME). */
export const CLOUD_CRITIQUE_KBPS = 64;
/** The listening summary sent as context is cut here (upstream: 16,000 characters). */
export const CLOUD_CRITIQUE_CONTEXT_CHARS = 16_000;
/** Gemini hears 32 tokens a second (Google's audio docs, as upstream cites them). */
export const GEMINI_AUDIO_TOKENS_PER_SECOND = 32;
/** The answer's cap: the rubric's JSON is a few thousand tokens at most. */
export const CLOUD_CRITIQUE_MAX_OUTPUT_TOKENS = 8192;

export const cloudCritiqueInputSchema = z
  .object({
    assetId: ulidSchema('Asset').optional().describe('The library recording or video to critique'),
    artifactId: ulidSchema('Artifact')
      .optional()
      .describe('Or an audio artifact from an earlier tool (a render’s sound, a mix)'),
    prompt: z
      .string()
      .trim()
      .min(1)
      .max(1000)
      .optional()
      .describe('A question of your own, answered besides the rubric: "Does the whoosh at 0:12 feel late?"'),
    withTimeline: z
      .boolean()
      .optional()
      .describe('Also send this Mac’s listening summary (events, sections, tempo, key) as text context'),
    synthIntended: z
      .boolean()
      .optional()
      .describe('The film uses synthesized or procedural sound on purpose: synthesis alone is not a flaw'),
    range: timeRangeSchema
      .optional()
      .describe(`Send only this part (at most ${CLOUD_CRITIQUE_MAX_SECONDS} s; longer sound is trimmed)`),
  })
  .refine((input) => (input.assetId === undefined) !== (input.artifactId === undefined), {
    message: 'Give exactly one of assetId and artifactId',
  });
export type CloudCritiqueInput = z.output<typeof cloudCritiqueInputSchema>;

export const CRITIQUE_SCORE_KEYS = ['sync', 'realism', 'mixBalance', 'loudness', 'music'] as const;
export type CritiqueScoreKey = (typeof CRITIQUE_SCORE_KEYS)[number];
export const CRITIQUE_SEVERITIES = ['high', 'medium', 'low'] as const;

const score = z.number().min(0).max(10).nullable();
const words = (max: number) => z.string().max(max);
const at = rationalTimeJsonSchema.nullable();

export const critiqueIssueSchema = z.object({
  start: at,
  end: at,
  severity: z.enum(CRITIQUE_SEVERITIES),
  /** The rubric's: sync, realism, mix, loudness, music, noise or edit (whatever the model wrote, cut short). */
  category: words(40),
  problem: words(600),
  fix: words(600),
});
export type CritiqueIssue = z.output<typeof critiqueIssueSchema>;

export const critiqueSoundSchema = z.object({
  start: at,
  end: at,
  what: words(300),
  why: words(600),
});

export const cloudCritiqueSchema = z.object({
  overall: z.object({ score, verdict: words(600) }),
  scores: z.object({
    sync: score,
    realism: score,
    mixBalance: score,
    loudness: score,
    music: score,
  }),
  notes: z.partialRecord(z.enum(CRITIQUE_SCORE_KEYS), words(1000)),
  syntheticOrCheap: z.array(critiqueSoundSchema).max(20),
  /** Most severe first, then by time. */
  issues: z.array(critiqueIssueSchema).max(40),
  strengths: z.array(words(300)).max(8),
  topFixes: z.array(words(600)).max(5),
  /** The answer to `prompt`, when one was asked. */
  answer: words(2000).optional(),
});
export type CloudCritique = z.output<typeof cloudCritiqueSchema>;

export const cloudCritiqueOutputSchema = z.object({
  /** A file name or the source's label, never a path. */
  source: z.string().max(300),
  provider: z.string(),
  model: z.string(),
  /** What left this Mac: the audio only, never the picture. */
  uploaded: z.object({
    bytes: z.int().nonnegative(),
    codec: z.string().max(60),
    start: rationalTimeJsonSchema,
    end: rationalTimeJsonSchema,
    /** The sound was longer than CLOUD_CRITIQUE_MAX_SECONDS (or the range asked) and only its start was sent. */
    trimmed: z.boolean(),
    /** This Mac's listening summary went with it as text. */
    withTimeline: z.boolean(),
  }),
  /** Null when the model answered but not in JSON: `raw` holds the start of what it said. */
  critique: cloudCritiqueSchema.nullable(),
  raw: z.string().max(4000).optional(),
  /** One line: the score, the verdict, the issue count and the top fix, and that it is an opinion. */
  summary: z.string().max(2000),
  /** What was not sent as context, and why ("the listening summary was not sent: …"). */
  notes: z.array(z.string().max(300)).max(5),
  usage: z.object({
    inputTokens: z.int().nonnegative(),
    outputTokens: z.int().nonnegative(),
    costUsd: z.number().nonnegative(),
  }),
});
export type CloudCritiqueOutput = z.output<typeof cloudCritiqueOutputSchema>;
