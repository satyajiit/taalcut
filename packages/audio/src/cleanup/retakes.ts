// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Retakes (SPEC P3.7), pure: adjacent phrases only (words split at pauses of 300 ms or more), never lines from
 * elsewhere. Both are normalised (lowercase, no punctuation, fillers dropped); the earlier is a `repeat` when
 * 1 − levenshtein / longer length reaches the threshold and the later is at least as long, or a `falseStart` when
 * it is a proper prefix of the later. The planner keeps the last complete take.
 */
import { CLEANUP_AUDIO_CONFIG } from './config';
import { normaliseWord, type Lexicon } from './lexicon';
import type { Span } from './segments';
import type { TimedWord } from './words';

export interface RetakeHit {
  readonly earlier: Span;
  readonly later: Span;
  readonly similarity: number;
  readonly kind: 'repeat' | 'falseStart';
}

interface Phrase extends Span {
  readonly text: string;
}

export function phrases(words: readonly TimedWord[], lexicon: Lexicon): Phrase[] {
  const out: { startMs: number; endMs: number; tokens: string[] }[] = [];
  for (const word of words) {
    const last = out.at(-1);
    const token = normaliseWord(word.text);
    if (!last || word.startMs - last.endMs >= CLEANUP_AUDIO_CONFIG.phraseGapMs)
      out.push({ startMs: word.startMs, endMs: word.endMs, tokens: [] });
    const current = out.at(-1);
    if (!current) continue;
    current.endMs = word.endMs;
    if (token && !lexicon.fillers.has(token)) current.tokens.push(token);
  }
  return out.map((p) => ({ startMs: p.startMs, endMs: p.endMs, text: p.tokens.join(' ') }));
}

export function levenshtein(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++)
      row.push(
        Math.min(
          (previous[j] ?? 0) + 1,
          (row[j - 1] ?? 0) + 1,
          (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1),
        ),
      );
    previous = row;
  }
  return previous[b.length] ?? 0;
}

export function findRetakes(words: readonly TimedWord[], lexicon: Lexicon): RetakeHit[] {
  const list = phrases(words, lexicon);
  const hits: RetakeHit[] = [];
  for (let i = 1; i < list.length; i++) {
    const earlier = list[i - 1];
    const later = list[i];
    if (!earlier || !later || earlier.text.length === 0 || later.text.length === 0) continue;
    const similarity =
      1 - levenshtein(earlier.text, later.text) / Math.max(earlier.text.length, later.text.length);
    const span = (p: Phrase): Span => ({ startMs: p.startMs, endMs: p.endMs });
    const prefix =
      earlier.text.length >= CLEANUP_AUDIO_CONFIG.falseStartMinChars &&
      later.text.length > earlier.text.length &&
      later.text.startsWith(earlier.text);
    if (prefix)
      hits.push({
        earlier: span(earlier),
        later: span(later),
        similarity: Math.round(similarity * 1000) / 1000,
        kind: 'falseStart',
      });
    else if (similarity >= CLEANUP_AUDIO_CONFIG.retakeSimilarity && later.text.length >= earlier.text.length)
      hits.push({
        earlier: span(earlier),
        later: span(later),
        similarity: Math.round(similarity * 1000) / 1000,
        kind: 'repeat',
      });
  }
  return hits;
}
