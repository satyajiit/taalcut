// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { describe, expect, it } from 'vitest';
import { graphemeCount, shareUnit, targetWords } from '../../src/translate/retime';
import { cueOf } from './captions';

const graphemes = (text: string) => [...new Intl.Segmenter('hi', { granularity: 'grapheme' }).segment(text)];

describe('targetWords', () => {
  it('keeps punctuation with its word, opening marks included', () => {
    expect(targetWords('¿Qué tal?  ¡Muy bien, gracias!', 'es')).toEqual([
      '¿Qué',
      'tal?',
      '¡Muy',
      'bien,',
      'gracias!',
    ]);
    expect(targetWords('"Hello," she said.', 'en')).toEqual(['"Hello,"', 'she', 'said.']);
  });

  it('splits Devanagari only between words', () => {
    const text = 'क्षत्रिय स्त्री ने कहा।';
    expect(targetWords(text, 'hi')).toEqual(['क्षत्रिय', 'स्त्री', 'ने', 'कहा।']);
  });
});

describe('graphemeCount', () => {
  it('counts a conjunct with its matras as one', () => {
    expect(graphemeCount('क्षि', 'hi')).toBe(1);
    expect(graphemeCount('café', 'es')).toBe(4);
  });
});

describe('shareUnit', () => {
  it('shares words in proportion to the cues’ source word time', () => {
    const cues = [
      cueOf({ text: 'one two three four', startMs: 0, endMs: 2000 }),
      cueOf({ text: 'five six', startMs: 2000, endMs: 3000 }),
    ];
    const shares = shareUnit(cues, 'aa bb cc dd ee ff', 'en');
    expect(shares.map((share) => share.text)).toEqual(['aa bb cc dd', 'ee ff']);
    expect(shares.map((share) => share.cueId)).toEqual(cues.map((cue) => cue.id));
  });

  it('weighs words by graphemes, so a long word takes its share', () => {
    const cues = [
      cueOf({ text: 'a b', startMs: 0, endMs: 1000 }),
      cueOf({ text: 'c d', startMs: 1000, endMs: 2000 }),
    ];
    expect(shareUnit(cues, 'extraordinarily x y z', 'en').map((share) => share.text)).toEqual([
      'extraordinarily',
      'x y z',
    ]);
  });

  it('keeps Devanagari graphemes whole and the words in order', () => {
    const text = 'इसमें दस मिनट लगते हैं और इसने मेरा पूरा हफ़्ता बदल दिया।';
    const cues = [
      cueOf({ text: 'It takes ten minutes', startMs: 0, endMs: 1200 }),
      cueOf({ text: 'and it changed my whole week.', startMs: 1200, endMs: 2800 }),
    ];
    const shares = shareUnit(cues, text, 'hi');
    expect(shares.map((share) => share.text).join(' ')).toBe(text);
    const whole = new Set(graphemes(text).map((part) => part.segment));
    for (const share of shares)
      for (const part of graphemes(share.text)) expect(whole.has(part.segment)).toBe(true);
  });

  it('gives a short cue at most one word per 120 ms when its neighbour has room', () => {
    const cues = [
      cueOf({ text: 'go', startMs: 0, endMs: 300 }),
      cueOf({ text: 'and see it all', startMs: 300, endMs: 2000 }),
    ];
    // By graphemes the 300 ms cue's share is a, b and c; at 120 ms a word it holds two.
    expect(shareUnit(cues, 'a b c d e f extraordinarily', 'en').map((share) => share.text)).toEqual([
      'a b',
      'c d e f extraordinarily',
    ]);
  });

  it('moves overflow back to an earlier cue when the last cue is too short', () => {
    const cues = [
      cueOf({ text: 'one two three', startMs: 0, endMs: 2400 }),
      cueOf({ text: 'four', startMs: 2400, endMs: 2700 }),
    ];
    const long = 'a'.repeat(20);
    expect(shareUnit(cues, `${long} b c d`, 'en').map((share) => share.text)).toEqual([`${long} b`, 'c d']);
  });

  it('gives every cue a word when there are enough', () => {
    const cues = [
      cueOf({ text: 'one two three four five six', startMs: 0, endMs: 3000 }),
      cueOf({ text: 'seven', startMs: 3000, endMs: 3100 }),
      cueOf({ text: 'eight', startMs: 3100, endMs: 3200 }),
    ];
    const shares = shareUnit(cues, 'uno dos tres', 'es');
    expect(shares.map((share) => share.text)).toEqual(['uno', 'dos', 'tres']);
  });

  it('leaves a cue without a word of its own empty, for render to drop, and shows no word twice', () => {
    const cues = [
      cueOf({ text: 'thank you', startMs: 0, endMs: 600 }),
      cueOf({ text: 'very much', startMs: 600, endMs: 1200 }),
    ];
    expect(shareUnit(cues, 'धन्यवाद।', 'hi').map((share) => share.text)).toEqual(['धन्यवाद।', '']);
    // Every cue still answers, each exactly once (captions.applyTranslation's rule).
    expect(shareUnit(cues, 'धन्यवाद।', 'hi').map((share) => share.cueId)).toEqual(cues.map((cue) => cue.id));
  });
});
