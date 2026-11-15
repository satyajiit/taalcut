// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { setupI18n } from '@lingui/core';
import { GRADE_LOOKS, NEUTRAL_GRADE } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { gradeFilterValues, gradeMatrix } from '../src/features/timeline/more/grade-matrix';
import {
  adjustmentWords,
  aspectOf,
  coverWords,
  gradeWords,
  holdWords,
  speedFigure,
  speedWords,
} from '../src/features/timeline/more/more-words';

const i18n = setupI18n({ locale: 'en', messages: { en: {} } });

describe('what the More tiles say', () => {
  it('names a speed in words, and as a figure on its card', () => {
    expect(speedWords(i18n, 1)).toBe('Normal speed');
    expect(speedWords(i18n, 0.5)).toBe('Half speed');
    expect(speedWords(i18n, 0.25)).toBe('0.25× speed');
    expect(speedWords(i18n, 4)).toBe('4× speed');
    expect(speedFigure(i18n, 1.5)).toBe('1.5×');
  });

  it('says an adjustment by its direction and whether it is a little, never as a number', () => {
    expect(adjustmentWords(i18n, 'exposure', 0)).toBeNull();
    expect(adjustmentWords(i18n, 'exposure', 0.3)).toBe('A little brighter');
    expect(adjustmentWords(i18n, 'exposure', 0.4)).toBe('Brighter');
    expect(adjustmentWords(i18n, 'exposure', -0.1)).toBe('A little darker');
    expect(adjustmentWords(i18n, 'exposure', -1)).toBe('Darker');
    expect(adjustmentWords(i18n, 'temperature', 0.2)).toBe('A little warmer');
    expect(adjustmentWords(i18n, 'temperature', -0.9)).toBe('Cooler');
    expect(adjustmentWords(i18n, 'saturation', 0.6)).toBe('More colour');
    expect(adjustmentWords(i18n, 'saturation', -0.2)).toBe('A little less colour');
  });

  it('says a scene’s colour as its look and what was adjusted, and what it has no slider for', () => {
    expect(gradeWords(i18n, undefined)).toBe('As shot');
    expect(gradeWords(i18n, {})).toBe('As shot');
    expect(gradeWords(i18n, { look: 'mono' })).toBe('Black and white');
    expect(gradeWords(i18n, { look: 'warm', exposure: 0.2 })).toBe('Warm · A little brighter');
    expect(gradeWords(i18n, { exposure: -0.5, temperature: 0.5, saturation: 0.5 })).toBe(
      'Darker · Warmer · More colour',
    );
    // A look turned all the way down is no look.
    expect(gradeWords(i18n, { look: 'vivid', lookStrength: 0 })).toBe('As shot');
    // Set by the AI or a shared adjustment, with no slider here: said, not hidden.
    expect(gradeWords(i18n, { contrast: 0.3 })).toBe('Fine-tuned');
    expect(gradeWords(i18n, { look: 'cool', tint: -0.2 })).toBe('Cool · Fine-tuned');
  });

  it('counts a hold’s seconds and the covers saved', () => {
    expect(holdWords(i18n, 1)).toBe('For 1 second');
    expect(holdWords(i18n, 2.5)).toBe('For 2.5 seconds');
    expect(coverWords(i18n, 0)).toBe('None chosen yet');
    expect(coverWords(i18n, 1)).toBe('1 cover saved');
    expect(coverWords(i18n, 3)).toBe('3 covers saved');
  });

  it('knows the video’s shape as one of the four sizes, whatever its pixels', () => {
    expect(aspectOf({ width: 1080, height: 1920 })).toBe('9:16');
    expect(aspectOf({ width: 720, height: 1280 })).toBe('9:16');
    expect(aspectOf({ width: 1080, height: 1350 })).toBe('4:5');
    expect(aspectOf({ width: 1080, height: 1080 })).toBe('1:1');
    expect(aspectOf({ width: 1920, height: 1080 })).toBe('16:9');
    expect(aspectOf({ width: 1000, height: 700 })).toBeNull();
  });
});

describe('a grade as the matrix a swatch is drawn with', () => {
  it('leaves the picture alone for no grade at all', () => {
    const identity = '1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0';
    expect(gradeFilterValues(null)).toBe(identity);
    expect(gradeFilterValues(undefined, undefined)).toBe(identity);
    expect(gradeFilterValues({}, NEUTRAL_GRADE)).toBe(identity);
  });

  // These two strings are what render's own sum gives for the same grades (packages/render/src/grade/
  // clip-grade.ts: feColorMatrixValues(visualGradeMatrix([...]))), taken on 2026-11-15. The renderer may not
  // import render, so the recipe is restated in grade-matrix.ts; if render's changes, these change with it.
  it('matches what render draws for a look with adjustments', () => {
    expect(gradeFilterValues({ look: 'warm', lookStrength: 0.5, exposure: 0.2, saturation: -0.6 })).toBe(
      '0.632073 0.498595 0.050378 0 0 0.143926 0.955587 0.048968 0 0 0.139772 0.470646 0.505497 0 0 0 0 0 1 0',
    );
  });

  it('matches what render draws for a scene’s grade under the whole video’s', () => {
    expect(gradeFilterValues({ look: 'mono' }, { exposure: 0.5 })).toBe(
      '0.330728 1.11259 0.112317 0 -0.070711 0.330728 1.11259 0.112317 0 -0.070711 0.330728 1.11259 0.112317 0 -0.070711 0 0 0 1 0',
    );
  });

  it('gives every look a matrix of its own, and black and white no colour', () => {
    const all = GRADE_LOOKS.map((look) => JSON.stringify(gradeMatrix({ look })));
    expect(new Set(all).size).toBe(GRADE_LOOKS.length);
    const [r, g, b] = gradeMatrix({ look: 'mono' });
    for (let column = 0; column < 4; column += 1) {
      expect(r[column]).toBeCloseTo(g[column]!, 10);
      expect(g[column]).toBeCloseTo(b[column]!, 10);
    }
    // Half a look is half the way from the picture as shot.
    const half = gradeMatrix({ look: 'mono', lookStrength: 0.5 });
    expect(half[0][0]).toBeCloseTo((1 + r[0]!) / 2, 10);
  });
});
