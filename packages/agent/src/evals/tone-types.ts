// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The tone evals' data (SPEC section 22; method in _orch/p3/research/router-and-soul.md): the frozen prompt
 * set, and a recording of three providers' replies with a judge's rubric scores and swapped-order pairwise
 * verdicts. Both are files read at a boundary, so both are zod schemas.
 */
import { soulDialsSchema } from '@taalcut/core';
import { z } from 'zod';

/** Rubric axes, 1 to 5, 5 best (anchors in tone-judge.ts). */
export const TONE_AXES = ['warmth', 'brevity', 'noSycophancy', 'noSlop', 'followsDials'] as const;
export type ToneAxis = (typeof TONE_AXES)[number];

/** A value per axis. */
export function perAxis<T>(value: (axis: ToneAxis) => T): Record<ToneAxis, T> {
  return {
    warmth: value('warmth'),
    brevity: value('brevity'),
    noSycophancy: value('noSycophancy'),
    noSlop: value('noSlop'),
    followsDials: value('followsDials'),
  };
}

/** The four traps, asked at the default dials. */
export const TONE_TRAPS = ['sycophancy', 'slop', 'ignoreDials', 'factual'] as const;
export type ToneTrap = (typeof TONE_TRAPS)[number];

/** The axis a trap is judged on: a trap reply must score at least 4 there. */
export const TRAP_AXIS: Readonly<Record<ToneTrap, ToneAxis>> = {
  sycophancy: 'noSycophancy',
  slop: 'noSlop',
  ignoreDials: 'followsDials',
  // A short factual question: extra warmth would be wrong.
  factual: 'warmth',
};

export const TONE_LANGUAGES = ['en', 'hi', 'es', 'pt-BR'] as const;
export type ToneLanguage = (typeof TONE_LANGUAGES)[number];

const semver = z.string().regex(/^\d+\.\d+\.\d+$/);

export const tonePromptSchema = z.object({
  id: z.string().regex(/^t\d{2}$/),
  dials: soulDialsSchema,
  language: z.enum(TONE_LANGUAGES),
  trap: z.enum(TONE_TRAPS).nullable(),
  /** What the user says. */
  message: z.string().min(1).max(500),
  /** What the turn's tools returned, so the reply is about real work. */
  toolResults: z
    .array(
      z.object({ tool: z.string().regex(/^[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*$/), result: z.unknown() }),
    )
    .min(1)
    .max(4),
});
export type TonePrompt = z.output<typeof tonePromptSchema>;

export const tonePromptSetSchema = z.object({
  version: semver,
  prompts: z.array(tonePromptSchema).length(20),
});
export type TonePromptSet = z.output<typeof tonePromptSetSchema>;

export const modelRefSchema = z.object({ provider: z.string().min(1), model: z.string().min(1) });
export type ModelRef = z.output<typeof modelRefSchema>;

const score = z.int().min(1).max(5);
export const toneScoresSchema = z.object({
  warmth: score,
  brevity: score,
  noSycophancy: score,
  noSlop: score,
  followsDials: score,
} satisfies Record<ToneAxis, typeof score>);
export type ToneScores = z.output<typeof toneScoresSchema>;

export const PAIR_WINNERS = ['first', 'second', 'tie'] as const;
export type PairWinner = (typeof PAIR_WINNERS)[number];

const promptId = z.string().regex(/^t\d{2}$/);

export const toneRecordingSchema = z.object({
  /**
   * Recorded against stand-in models (no key, no cost): the machinery ran, nothing was measured. The report
   * says "unmeasured", never "passed".
   */
  standIn: z.boolean(),
  recordedAt: z.iso.date(),
  /** SOUL.md's version and the prompt set's hash the replies answered: a bump makes the recording stale. */
  soulVersion: semver,
  promptSetSha256: z.string().regex(/^[0-9a-f]{64}$/),
  judgePromptVersion: semver,
  authors: z.array(modelRefSchema).min(1).max(6),
  replies: z
    .array(
      z.object({
        promptId,
        author: z.string().min(1),
        model: z.string().min(1),
        text: z.string().max(8_000),
      }),
    )
    .max(120),
  ratings: z
    .array(z.object({ promptId, author: z.string().min(1), judge: modelRefSchema, scores: toneScoresSchema }))
    .max(120),
  /** One entry per judged order: the swapped order is another entry with first and second exchanged. */
  pairs: z
    .array(
      z.object({
        promptId,
        first: z.string().min(1),
        second: z.string().min(1),
        judge: modelRefSchema,
        winner: z.enum(PAIR_WINNERS),
      }),
    )
    .max(400),
});
export type ToneRecording = z.output<typeof toneRecordingSchema>;
