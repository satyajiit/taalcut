// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** LIB1-LANG: the language decision, pure. */
import { describe, expect, it } from 'vitest';
import {
  aggregatePieces,
  decideLanguage,
  LANGUAGE_DECISION,
  withPrior,
  type IdentifiedPiece,
  type LanguageScore,
} from '../../src/speech/language-decision';

const scores = (entries: Record<string, number>): LanguageScore[] =>
  Object.entries(entries).map(([language, probability]) => ({ language, probability }));

const piece = (startMs: number, endMs: number, entries: Record<string, number>): IdentifiedPiece => ({
  startMs,
  endMs,
  scores: scores(entries),
});

describe('decideLanguage', () => {
  it('obeys the language the person chose', () => {
    const decided = decideLanguage({ chosen: 'or', whisper: scores({ ne: 0.9 }), spoken: [] });
    expect(decided).toEqual({ state: 'chosen', languages: ['or'], confidence: null, source: 'chosen' });
  });

  it('lets Whisper decide a language the identifier can not name', () => {
    const decided = decideLanguage({
      whisper: scores({ es: 0.92, pt: 0.05 }),
      pieces: [piece(0, 4000, { hi: 0.4, en: 0.3, mr: 0.3 })],
      spoken: ['en'],
    });
    expect(decided).toMatchObject({ state: 'detected', languages: ['es'], source: 'whisper' });
  });

  it('names Odia from the identifier, which Whisper never can', () => {
    const decided = decideLanguage({
      whisper: scores({ bn: 0.41, ne: 0.2, hi: 0.1 }),
      pieces: [piece(0, 6000, { or: 0.86, bn: 0.08, as: 0.03, en: 0.03 })],
      spoken: ['en'],
    });
    expect(decided).toMatchObject({ state: 'detected', languages: ['or'], source: 'identifier' });
    expect(decided.confidence).toBeGreaterThan(0.8);
  });

  it('says unclear rather than guess on a short piece nobody is sure of', () => {
    // A spread answer, its likeliest under the floor, as on a few seconds of shouting.
    const unsure = piece(1000, 3500, {
      mai: 0.3, mr: 0.22, as: 0.1, sat: 0.08, te: 0.06, gu: 0.05, ne: 0.05, bn: 0.04, or: 0.03, hi: 0.02,
      en: 0.02, ta: 0.02, kn: 0.01,
    }); // prettier-ignore
    const without = decideLanguage({ whisper: scores({ vi: 0.2 }), pieces: [unsure], spoken: ['en'] });
    expect(without).toMatchObject({ state: 'unclear', languages: [], source: 'identifier' });
    // The person's languages lean the call toward theirs, but not past the floor: still unclear.
    const leaning = decideLanguage({
      whisper: scores({ vi: 0.2 }),
      pieces: [unsure],
      spoken: ['or', 'hi', 'en'],
    });
    expect(leaning.state).toBe('unclear');
    expect(leaning.languages).toEqual([]);
  });

  it('says "Hindi and English" when pieces are each sure of a different language', () => {
    const decided = decideLanguage({
      whisper: scores({ hi: 0.6, en: 0.3 }),
      pieces: [
        piece(0, 5000, { hi: 0.9, ur: 0.05, en: 0.05 }),
        piece(5600, 10_000, { en: 0.88, hi: 0.1, ur: 0.02 }),
        piece(10_500, 15_000, { hi: 0.8, en: 0.15, ur: 0.05 }),
      ],
      spoken: ['hi', 'en'],
    });
    expect(decided).toMatchObject({ state: 'mixed', languages: ['hi', 'en'], source: 'identifier' });
  });

  it('hears a change of language after the first sentences, but never lets later sound name the clip', () => {
    const hindi = [piece(0, 10_000, { hi: 0.93, ur: 0.05, en: 0.02 })];
    const english = piece(40_000, 48_000, { en: 0.9, hi: 0.08, ur: 0.02 });
    const mixed = decideLanguage({
      whisper: scores({ hi: 0.8 }),
      pieces: hindi,
      later: [english],
      spoken: [],
    });
    expect(mixed).toMatchObject({ state: 'mixed', languages: ['hi', 'en'] });
    // Unsure later sound (music, crowd) changes nothing.
    const noise = piece(40_000, 52_000, { mai: 0.3, en: 0.25, sat: 0.2, hi: 0.25 });
    const one = decideLanguage({ whisper: scores({ hi: 0.8 }), pieces: hindi, later: [noise], spoken: [] });
    expect(one).toMatchObject({ state: 'detected', languages: ['hi'] });
  });

  it('does not call a clip mixed on a short piece or a small share', () => {
    const decided = decideLanguage({
      whisper: scores({ hi: 0.85 }),
      pieces: [piece(0, 9000, { hi: 0.92, en: 0.08 }), piece(9500, 10_800, { en: 0.9, hi: 0.1 })],
      spoken: [],
    });
    expect(decided).toMatchObject({ state: 'detected', languages: ['hi'] });
  });

  it('keeps a sure Whisper answer the identifier also ranks near the top', () => {
    const decided = decideLanguage({
      whisper: scores({ en: 0.9 }),
      pieces: [piece(0, 3000, { hi: 0.35, en: 0.33, ur: 0.32 })],
      spoken: [],
    });
    expect(decided).toMatchObject({ state: 'detected', languages: ['en'], source: 'whisper' });
  });

  it('decides with Whisper alone, against its floor, when the identifier did not run', () => {
    expect(decideLanguage({ whisper: scores({ de: 0.95 }), spoken: [] })).toMatchObject({
      state: 'detected',
      languages: ['de'],
      source: 'whisper',
    });
    expect(decideLanguage({ whisper: scores({ ar: 0.168 }), spoken: [] })).toMatchObject({
      state: 'unclear',
    });
    expect(decideLanguage({ spoken: [] })).toMatchObject({ state: 'unclear', source: 'none' });
  });

  it('lets the person’s languages lift a fairly sure answer over the floor, never force another', () => {
    const fairly = scores({ ur: 0.7, hi: 0.25, en: 0.05 });
    expect(decideLanguage({ whisper: fairly, spoken: [] })).toMatchObject({ state: 'unclear' });
    expect(decideLanguage({ whisper: fairly, spoken: ['ur'] })).toMatchObject({ languages: ['ur'] });
    expect(decideLanguage({ whisper: fairly, spoken: ['hi'] })).toMatchObject({ state: 'unclear' });
    const clear = scores({ ta: 0.9, ml: 0.1 });
    expect(decideLanguage({ whisper: clear, spoken: ['ml'] })).toMatchObject({ languages: ['ta'] });
  });
});

describe('withPrior', () => {
  it('keeps what Whisper left unnamed in the total, so one named language is not made certain', () => {
    const [only] = withPrior(scores({ fr: 0.3 }), [], LANGUAGE_DECISION.priorWeight);
    expect(only?.probability).toBeCloseTo(0.3);
    const [leaned] = withPrior(scores({ fr: 0.3 }), ['fr'], 3);
    expect(leaned?.probability).toBeCloseTo(0.9 / 1.6);
  });
});

describe('aggregatePieces', () => {
  it('weights the pieces by their length', () => {
    const together = aggregatePieces(
      [piece(0, 9000, { hi: 0.9, en: 0.1 }), piece(9000, 10_000, { hi: 0.1, en: 0.9 })],
      [],
      1,
    );
    expect(together[0]?.language).toBe('hi');
  });
});
