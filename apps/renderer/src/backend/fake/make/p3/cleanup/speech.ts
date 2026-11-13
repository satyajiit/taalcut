// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The speech analysis audio's `audio.analyzeSpeech` job would write for a talking clip (core's
 * SpeechCleanupAnalysis), made up from a seed so the fake's cleanup plans are the same every run: phrases of
 * words, an "um" or "uh" now and then, pauses between phrases (some long), a false start said again, a stressed
 * word every other phrase, and "like" or "so" left alone. Only the assets the talking-head seed registers have
 * one; every other asset has no speech (so cleanup answers timeline.cleanup_no_speech for them).
 */
import { RationalTime, type AssetId, type SpeechCleanupAnalysis, type TimeRange } from '@taalcut/core';
import { prng } from '../../../library/seed';

const MS = { num: 1000, den: 1 } as const;
const range = (start: number, end: number): TimeRange => ({
  start: RationalTime.of(Math.round(start), MS),
  duration: RationalTime.of(Math.max(1, Math.round(end - start)), MS),
});

const WORDS = [
  'today',
  'we',
  'are',
  'making',
  'chai',
  'the',
  'way',
  'my',
  'grandmother',
  'did',
  'first',
  'boil',
  'water',
  'with',
  'ginger',
  'then',
  'add',
  'tea',
  'leaves',
  'and',
  'wait',
  'for',
  'colour',
  'milk',
  'goes',
  'in',
  'last',
  'sugar',
  'to',
  'taste',
  'strain',
  'it',
  'into',
  'glass',
  'that',
  'is',
  'all',
  'you',
  'need',
];

const registry = new Map<AssetId, SpeechCleanupAnalysis>();

/** The talking-head seed's footage gets an analysis; the cleanup fake reads it here. */
export function registerSpeech(analysis: SpeechCleanupAnalysis): void {
  registry.set(analysis.assetId, analysis);
}

export function speechOf(assetId: AssetId): SpeechCleanupAnalysis | null {
  return registry.get(assetId) ?? null;
}

interface Builder {
  words: SpeechCleanupAnalysis['words'][number][];
  speech: TimeRange[];
  fillers: SpeechCleanupAnalysis['fillers'][number][];
  retakes: SpeechCleanupAnalysis['retakes'][number][];
  emphasis: SpeechCleanupAnalysis['emphasis'][number][];
  ambiguous: SpeechCleanupAnalysis['ambiguous'][number][];
}

/** One phrase from `at` (ms); returns where it ends. */
function phrase(
  out: Builder,
  at: number,
  texts: readonly string[],
  random: () => number,
  stress: boolean,
): number {
  let t = at;
  const first = out.words.length;
  texts.forEach((text, index) => {
    const length = 220 + random() * 180;
    out.words.push({ text, range: range(t, t + length), confidence: 0.94 });
    if (stress && index === texts.length - 2)
      out.emphasis.push({
        wordIndex: out.words.length - 1,
        range: range(t, t + length),
        strength: 0.8 + random() * 0.15,
      });
    if (text === 'so' || text === 'like')
      out.ambiguous.push({ wordIndex: out.words.length - 1, range: range(t, t + length) });
    t += length + 40;
  });
  const start = RationalTime.toSeconds(out.words[first]?.range.start ?? RationalTime.of(at, MS)) * 1000;
  out.speech.push(range(start, t - 40));
  return t - 40;
}

/** A talking clip's analysis over `seconds` of its media. */
export function speechAnalysis(assetId: AssetId, seconds: number, seed: number): SpeechCleanupAnalysis {
  const random = prng(seed * 7919 + 13);
  const out: Builder = { words: [], speech: [], fillers: [], retakes: [], emphasis: [], ambiguous: [] };
  const end = seconds * 1000 - 400;
  let t = 300;
  let n = 0;
  while (t < end - 2500) {
    const count = 4 + Math.floor(random() * 5);
    const texts = Array.from(
      { length: count },
      (_, i) => WORDS[(n * 7 + i * 3 + seed) % WORDS.length] ?? 'so',
    );
    if (n % 5 === 3) texts.splice(1, 0, 'so');
    if (random() < 0.45) {
      // An "um" before the phrase: its own word and its own speech.
      const length = 280 + random() * 120;
      out.words.push({ text: random() < 0.5 ? 'um' : 'uh', range: range(t, t + length), confidence: 0.9 });
      out.fillers.push({
        range: range(t, t + length),
        text: out.words.at(-1)?.text ?? 'um',
        wordIndex: out.words.length - 1,
        confidence: 0.88,
      });
      out.speech.push(range(t, t + length));
      t += length + 120;
    }
    if (n % 4 === 2) {
      // A false start, said again after a breath: the earlier take goes.
      const startedAt = t;
      const ended = phrase(out, t, texts.slice(0, 3), random, false);
      t = ended + 450;
      const laterAt = t;
      t = phrase(out, t, texts, random, n % 2 === 0);
      out.retakes.push({
        earlier: range(startedAt, ended),
        later: range(laterAt, t),
        similarity: 0.91,
        kind: 'repeat',
      });
    } else {
      t = phrase(out, t, texts, random, n % 2 === 0);
    }
    t += n % 3 === 1 ? 900 + random() * 700 : 260 + random() * 200;
    n += 1;
  }
  const pauses = out.speech
    .map((span) => span)
    .sort((a, b) => RationalTime.compare(a.start, b.start))
    .flatMap((span, index, sorted) => {
      const next = sorted[index + 1];
      if (!next) return [];
      const from = RationalTime.toSeconds(span.start) * 1000 + RationalTime.toSeconds(span.duration) * 1000;
      const to = RationalTime.toSeconds(next.start) * 1000;
      return to - from >= 200 ? [{ range: range(from, to) }] : [];
    });
  return {
    version: 1,
    assetId,
    contentHash: `fake-speech-${seed}`,
    configVersion: 1,
    language: 'en',
    engine: 'parakeet',
    ...out,
    pauses,
  };
}
