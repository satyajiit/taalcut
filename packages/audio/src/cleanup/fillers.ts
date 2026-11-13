// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Fillers (SPEC P3.7), pure. Neither Parakeet nor whisper.cpp keeps "um" reliably, so a filler needs both a
 * closed-list word and a short voiced burst: the VAD's voiced time inside the word is 80–400 ms, and that voiced
 * time is the filler's range (the VAD, not the word timing, decides the edges). A voiced island no word covers,
 * between two words and shorter than 250 ms, is a filler the transcript missed (text null). Ambiguous words
 * ("like", "so", "तो") are reported and never treated as fillers.
 */
import { CLEANUP_AUDIO_CONFIG } from './config';
import { normaliseWord, type Lexicon } from './lexicon';
import { overlapMs, type Span } from './segments';
import type { TimedWord } from './words';

export interface FillerHit {
  readonly range: Span;
  readonly text: string | null;
  readonly wordIndex: number | null;
  readonly confidence: number;
}

export interface AmbiguousHit {
  readonly wordIndex: number;
  readonly range: Span;
}

const { minMs, maxMs, untranscribedMaxMs, overlapMs: minOverlap } = CLEANUP_AUDIO_CONFIG.filler;

/** The voiced part of a span: from the first to the last voiced window inside it, and how long it voices. */
function voicedInside(span: Span, islands: readonly Span[]): { range: Span; voicedMs: number } | null {
  let first: number | null = null;
  let last = 0;
  let voicedMs = 0;
  for (const island of islands) {
    const o = overlapMs(island, span);
    if (o <= 0) continue;
    first ??= Math.max(island.startMs, span.startMs);
    last = Math.min(island.endMs, span.endMs);
    voicedMs += o;
  }
  return first === null ? null : { range: { startMs: first, endMs: last }, voicedMs };
}

export function findFillers(
  words: readonly TimedWord[],
  islands: readonly Span[],
  lexicon: Lexicon,
): FillerHit[] {
  const hits: FillerHit[] = [];
  words.forEach((word, index) => {
    if (!lexicon.fillers.has(normaliseWord(word.text))) return;
    const voiced = voicedInside(word, islands);
    if (!voiced || voiced.voicedMs < minMs || voiced.voicedMs > maxMs) return;
    hits.push({ range: voiced.range, text: word.text, wordIndex: index, confidence: word.confidence });
  });
  for (const island of islands) {
    const length = island.endMs - island.startMs;
    if (length < minMs || length >= untranscribedMaxMs) continue;
    if (words.some((w) => overlapMs(w, island) >= minOverlap)) continue;
    const before = words.some((w) => w.endMs <= island.startMs);
    const after = words.some((w) => w.startMs >= island.endMs);
    // Confidence is lower than a transcribed filler's: nothing said what the sound was.
    if (before && after) hits.push({ range: island, text: null, wordIndex: null, confidence: 0.6 });
  }
  return hits.sort((a, b) => a.range.startMs - b.range.startMs);
}

export function findAmbiguous(words: readonly TimedWord[], lexicon: Lexicon): AmbiguousHit[] {
  const normal = words.map((w) => normaliseWord(w.text));
  const hits: AmbiguousHit[] = [];
  normal.forEach((_, i) => {
    for (const phrase of lexicon.ambiguous) {
      if (!phrase.every((token, k) => normal[i + k] === token)) continue;
      const last = words[i + phrase.length - 1];
      const first = words[i];
      if (first && last) hits.push({ wordIndex: i, range: { startMs: first.startMs, endMs: last.endMs } });
      return;
    }
  });
  return hits;
}
