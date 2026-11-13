// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Words to transcript segments. Breaks at sentence punctuation, at a pause
 * of `pauseBreakMs`, and so a segment stays within `maxSegmentTokens`.
 * Onset snapping (±120 ms, `AUDIO_CONFIG.speech.refineWordOnsets` /
 * `refineWindowMs`) is a flag and is off: word starts are not moved.
 */
import {
  spokenLanguageSchema,
  type Transcript,
  type TranscriptEngine,
  type TranscriptSegment,
  type TranscriptWord,
} from '@taalcut/core';
import { AUDIO_CONFIG } from '../config';
import { msRange, rangeToMs } from '../rates';

const SENTENCE_END = /[.!?।]$/u;

function languageTag(language: string | null | undefined): string {
  const trimmed = language?.trim() ?? '';
  if (trimmed.length === 0) return 'und';
  return spokenLanguageSchema.safeParse(trimmed).success ? trimmed : 'und';
}

function tokenCount(tokenCounts: readonly number[] | undefined, index: number): number {
  const value = tokenCounts?.[index];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) return 1;
  return Math.floor(value);
}

/**
 * `tokenCounts` is parallel to `words`. The spec's cap is 512 tokens; each
 * word counts as one token unless the caller still has the token tally.
 */
export function segmentWords(
  words: readonly TranscriptWord[],
  language: string,
  tokenCounts?: readonly number[],
): TranscriptSegment[] {
  const lang = languageTag(language);
  const pauseMs = AUDIO_CONFIG.speech.pauseBreakMs;
  const maxTokens = AUDIO_CONFIG.speech.maxSegmentTokens;
  const segments: TranscriptSegment[] = [];
  let current: TranscriptWord[] = [];
  let tokens = 0;

  const flush = (): void => {
    if (current.length === 0) return;
    const first = current[0];
    const last = current[current.length - 1];
    if (!first || !last) return;
    const startMs = rangeToMs(first.range).startMs;
    const endMs = rangeToMs(last.range).endMs;
    segments.push({
      text: current.map((word) => word.text).join(' '),
      range: msRange(startMs, Math.max(0, endMs - startMs)),
      words: current,
      language: lang,
    });
    current = [];
    tokens = 0;
  };

  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    if (!word) continue;
    const count = tokenCount(tokenCounts, index);
    if (current.length > 0 && tokens + count > maxTokens) flush();
    current.push(word);
    tokens += count;
    const next = words[index + 1];
    const pause =
      next !== undefined && rangeToMs(next.range).startMs - rangeToMs(word.range).endMs >= pauseMs;
    if (SENTENCE_END.test(word.text) || pause) flush();
  }
  flush();
  return segments;
}

export function buildTranscript(input: {
  language: string | null;
  engine: TranscriptEngine;
  model: string;
  local: boolean;
  words: readonly TranscriptWord[];
  wordTiming?: 'native' | 'refined';
}): Transcript {
  const words = input.words.flatMap((word) => {
    const text = word.text.normalize('NFC');
    if (text.length === 0) return [];
    return [text === word.text ? word : { ...word, text }];
  });
  const language = languageTag(input.language);
  return {
    version: 1,
    language,
    segments: segmentWords(words, language),
    engine: input.engine,
    model: input.model,
    local: input.local,
    wordTiming: input.wordTiming ?? 'native',
  };
}
