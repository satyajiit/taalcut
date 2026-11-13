// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `whisper-server`'s `verbose_json`, checked at the boundary and mapped to the tokens `whisper-cli -ojf` gives.
 * The server leaves out special tokens (the parser drops them anyway) and joins a token that ends inside a UTF-8
 * character with the next one, keeping the first one's time and probability; the parser joins those bytes the
 * same way, so the words are the same (a joined token's confidence counts it once).
 * Times: `start`/`end` are whisper's centiseconds as seconds, `t_dtw` stays in centiseconds. Probabilities are
 * rounded to the six decimals `-ojf` prints, so a transcript is the same from either path, confidences included.
 */
import { z } from 'zod';
import type { WhisperToken } from '../speech/whisper-parse';
import type { WhisperDecoded, WhisperLanguageGuess } from './decoder';

const wordSchema = z.object({
  word: z.string(),
  start: z.number().nullish(),
  end: z.number().nullish(),
  t_dtw: z.number().nullish(),
  /** A NaN is written as null (JSON has no NaN). */
  probability: z.number().nullish(),
});

export const verboseJsonSchema = z.object({
  language: z.string().optional(),
  segments: z.array(z.object({ words: z.array(wordSchema).optional() })).default([]),
  detected_language_probability: z.number().optional(),
  /** Short codes, e.g. `en`; only those over 0.001. Absent with `no_language_probabilities`. */
  language_probabilities: z.record(z.string(), z.number()).optional(),
});
export type VerboseJson = z.output<typeof verboseJsonSchema>;

export const serverErrorSchema = z.object({ error: z.string() });

function finite(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function ms(seconds: number | null | undefined): number {
  return finite(seconds) ? Math.round(seconds * 1000) : 0;
}

/** The most likely language and its probability, from the distribution. */
export function topLanguage(json: VerboseJson): WhisperLanguageGuess | null {
  let best: WhisperLanguageGuess | null = null;
  for (const [language, probability] of Object.entries(json.language_probabilities ?? {}))
    if (!best || probability > best.probability) best = { language, probability };
  return best;
}

/** The likeliest languages, most likely first (LIB1-LANG: the language decision's first pass). */
export function languageDistribution(json: VerboseJson, limit = 8): WhisperLanguageGuess[] {
  return Object.entries(json.language_probabilities ?? {})
    .map(([language, probability]) => ({ language, probability }))
    .sort((a, b) => b.probability - a.probability)
    .slice(0, limit);
}

export function tokensOf(json: VerboseJson): WhisperToken[] {
  const tokens: WhisperToken[] = [];
  for (const segment of json.segments)
    for (const word of segment.words ?? []) {
      tokens.push({
        text: word.word,
        fromMs: ms(word.start),
        toMs: ms(word.end),
        ...(finite(word.probability) ? { probability: Number(word.probability.toFixed(6)) } : {}),
        ...(finite(word.t_dtw) && word.t_dtw >= 0 ? { dtwMs: word.t_dtw * 10 } : {}),
      });
    }
  return tokens;
}

/** `asked` is the language requested; for `auto`, what whisper detected. */
export function decodedOf(json: VerboseJson, asked: string): WhisperDecoded {
  const language = asked === 'auto' ? (topLanguage(json)?.language ?? null) : asked;
  return { tokens: tokensOf(json), language };
}
