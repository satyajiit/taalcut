// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { describe, expect, it } from 'vitest';
import { findEmphasis } from '../../src/cleanup/emphasis';
import { findAmbiguous, findFillers } from '../../src/cleanup/fillers';
import { lexiconFor } from '../../src/cleanup/lexicon';
import { findRetakes } from '../../src/cleanup/retakes';
import { pausesBetween, speechSegments, voicedIslands } from '../../src/cleanup/segments';
import type { TimedWord } from '../../src/cleanup/words';

const W = 32;
/** Probabilities from voiced spans in ms. */
function probs(totalMs: number, voiced: readonly [number, number][]): Float32Array {
  const out = new Float32Array(Math.ceil(totalMs / W));
  out.forEach((_, i) => {
    const t = i * W;
    out[i] = voiced.some(([a, b]) => t >= a && t < b) ? 0.9 : 0.05;
  });
  return out;
}
const word = (text: string, startMs: number, endMs: number): TimedWord => ({
  text,
  startMs,
  endMs,
  confidence: 0.9,
});
const en = lexiconFor('en');

describe('VAD segments and pauses', () => {
  it('keeps short bursts as their own segments and records every gap of 200 ms or more', () => {
    const p = probs(4000, [
      [0, 1000],
      [1250, 1410],
      [1600, 2400],
      [2650, 3000],
    ]);
    const segments = speechSegments(p, W);
    expect(segments).toHaveLength(4);
    const pauses = pausesBetween(segments).map((s) => Math.round(s.endMs - s.startMs));
    expect(pauses.length).toBe(2);
    expect(pauses.every((d) => d >= 200)).toBe(true);
  });
});

describe('fillers', () => {
  it('needs a list word and a short voiced burst inside it', () => {
    const islands = voicedIslands(
      probs(3000, [
        [0, 900],
        [1000, 1250],
        [1400, 2600],
      ]),
      W,
    );
    const words = [
      word('So', 0, 300),
      word('um,', 1000, 1250),
      word('the', 1400, 1600),
      word('product', 1600, 2000),
    ];
    const fillers = findFillers(words, islands, en);
    expect(fillers).toHaveLength(1);
    expect(fillers[0]).toMatchObject({ text: 'um,', wordIndex: 1 });
  });

  it('finds an untranscribed burst between kept words, never a long one', () => {
    const islands = voicedIslands(
      probs(4000, [
        [0, 600],
        [800, 990],
        [1200, 1900],
        [2100, 2500],
        [2700, 3400],
      ]),
      W,
    );
    const words = [word('Hello', 0, 600), word('there', 1200, 1900), word('friend', 2700, 3400)];
    const fillers = findFillers(words, islands, en);
    expect(fillers.map((f) => [f.text, Math.round(f.range.startMs)])).toEqual([[null, 800]]);
  });

  it('reports "like" and "you know" as ambiguous, never as fillers', () => {
    const words = [
      word('It', 0, 100),
      word('was,', 100, 300),
      word('like,', 300, 500),
      word('you', 600, 700),
      word('know', 700, 900),
    ];
    expect(findFillers(words, voicedIslands(probs(1000, [[0, 950]]), W), en)).toEqual([]);
    expect(findAmbiguous(words, en).map((a) => a.wordIndex)).toEqual([2, 3]);
  });
});

describe('retakes', () => {
  it('finds a repeat and a false start between adjacent phrases only', () => {
    const say = (text: string, at: number) =>
      text.split(' ').map((t, i) => word(t, at + i * 250, at + i * 250 + 200));
    const words = [
      ...say('keep the music low', 0),
      ...say('keep the music low and the voice clear', 1500),
      ...say('the product is', 5000),
      ...say('the product is great', 6500),
      ...say('something else entirely', 9000),
    ];
    const retakes = findRetakes(words, en);
    expect(retakes.map((r) => r.kind)).toEqual(['falseStart', 'falseStart']);
    const repeat = findRetakes([...say('um this is the bit', 0), ...say('this is the bit', 1600)], en);
    expect(repeat.map((r) => [r.kind, r.similarity])).toEqual([['repeat', 1]]);
  });
});

describe('emphasis', () => {
  it('marks words well above the median peak, 4 s apart, not in the first 0.5 s', () => {
    const rate = 16_000;
    const samples = new Float32Array(rate * 12);
    const words: TimedWord[] = [];
    for (let i = 0; i < 20; i++) {
      const start = 200 + i * 550;
      const loud = i === 0 || i === 8 || i === 9 || i === 16;
      for (let s = (start * rate) / 1000; s < ((start + 400) * rate) / 1000; s++)
        samples[s] = (loud ? 0.6 : 0.2) * Math.sin(s / 5);
      words.push(word(`w${i}`, start, start + 400));
    }
    const islands = words.map((w) => ({ startMs: w.startMs, endMs: w.endMs }));
    const hits = findEmphasis({ samples, sampleRate: rate, words, islands, fillerWords: new Set() });
    expect(hits.map((h) => h.wordIndex)).toEqual([8, 16]);
    expect(hits.every((h) => h.strength > 0 && h.strength <= 1)).toBe(true);
  });
});
