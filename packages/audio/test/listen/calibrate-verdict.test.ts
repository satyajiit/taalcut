// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-F5: the verdict bands, D23's borderline flag, and the property that a hint category (genre, mood,
 * instruments, voice) never gets a verdict, whatever the sound and the z: random vocabularies and sounds, seeded.
 */
import { HINT_CATEGORIES, SOUND_TAG_CATEGORIES, soundTagSchema } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { scoreQueries, topTerms, toSoundTag } from '../../src/listen/calibrate/match';
import { calibrate } from '../../src/listen/calibrate/score';
import {
  floorZ,
  isBorderline,
  roundTo,
  softmax,
  verdictFor,
  verdictOf,
} from '../../src/listen/calibrate/verdict';
import { createVocab, vocabStats, vocabTerms } from '../../src/listen/calibrate/vocab';

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function unitRow(next: () => number): Float32Array {
  const row = Float32Array.from({ length: 512 }, () => next() - 0.5);
  const norm = Math.hypot(...row);
  return row.map((v) => v / norm);
}

describe('verdict bands', () => {
  it('strong from 3.0, plausible from 2.5, weak from 2.0, judged on the z rounded to 2 decimals', () => {
    expect([3.0, 2.996, 2.994, 2.5, 2.49, 2.0, 1.999, -4].map(verdictOf)).toEqual([
      'strong',
      'strong',
      'plausible',
      'plausible',
      'weak',
      'weak',
      'weak',
      'no_match',
    ]);
  });

  it('D23: borderline within ±0.15 of a band start, the verdict still from z', () => {
    expect(isBorderline(2.86)).toBe(true);
    expect(isBorderline(3.15)).toBe(true);
    expect(isBorderline(2.2)).toBe(false);
    expect(isBorderline(1.85)).toBe(true);
    expect(verdictOf(2.86)).toBe('plausible');
  });

  it('floors z for text (2.96 reads 2.9) and rounds like Python', () => {
    expect(floorZ(2.96)).toBe(2.9);
    expect(floorZ(-0.04)).toBe(-0.1);
    expect(roundTo(0.125, 2)).toBe(0.12);
    expect(roundTo(2.675, 2)).toBe(2.67);
  });

  it('softmax with the logit scale', () => {
    const p = softmax([0.3, 0.2], vocabStats().logitScale);
    expect(p[0]).toBeCloseTo(1 / (1 + Math.exp(-0.1 * 38.75)), 9);
  });
});

describe('hint categories never get a verdict (property)', () => {
  it('for any z and any category', () => {
    const next = random(1);
    for (let i = 0; i < 20_000; i++) {
      const z = (next() - 0.5) * 20;
      const category = SOUND_TAG_CATEGORIES[Math.floor(next() * SOUND_TAG_CATEGORIES.length)] ?? 'voice';
      const verdict = verdictFor(z, category);
      if ((HINT_CATEGORIES as readonly string[]).includes(category)) expect(verdict).toBeNull();
      else expect(verdict).toBe(verdictOf(z));
    }
  });

  it('for random vocabularies, sounds and queries, through top terms, queries and SoundTag', () => {
    const terms = vocabTerms();
    for (let seed = 1; seed <= 12; seed++) {
      const next = random(seed);
      const vocab = createVocab(terms.terms.map(() => unitRow(next)));
      // A sound close to one term, so some z are far above 3.
      const target = vocab.rows[Math.floor(next() * vocab.rows.length)] ?? unitRow(next);
      const noise = unitRow(next);
      const audio = target.map((v, i) => v * 0.8 + (noise[i] ?? 0) * 0.2);
      const sound = calibrate(audio, vocab);
      for (const tag of topTerms(sound, vocab, terms.terms.length).map(toSoundTag)) {
        expect(soundTagSchema.safeParse(tag).success).toBe(true);
        if ((HINT_CATEGORIES as readonly string[]).includes(tag.category)) {
          expect(tag.hint).toBe(true);
          expect(tag.verdict).toBeNull();
        }
      }
      const queries = vocab.rows.slice(0, 40).map((row, i) => ({ text: `q${i}`, embedding: row }));
      for (const score of scoreQueries(audio, queries, vocab)) {
        if (score.hint) expect(score.verdict).toBeNull();
        else expect(score.verdict).not.toBeNull();
        expect(soundTagSchema.safeParse(toSoundTag(score)).success).toBe(true);
      }
    }
  });
});
