// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** EDT1-OPS: a grade as one colour matrix: each control's direction, the looks, a clip's grade under the video's. */
import { NEUTRAL_GRADE, type Grade } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import {
  applyMatrix,
  composeMatrices,
  feColorMatrixValues,
  gradeMatrix,
  IDENTITY_MATRIX,
  visualGradeMatrix,
} from '../../src/grade/clip-grade';

const grade = (patch: Partial<Grade>): Grade => ({ ...NEUTRAL_GRADE, ...patch });
const SKIN: [number, number, number] = [0.8, 0.6, 0.5];
const luma = ([r, g, b]: readonly number[]) => 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
const close = (actual: readonly number[], expected: readonly number[]) =>
  actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index]!, 5));

describe('gradeMatrix', () => {
  it('leaves colour alone when neutral, and a neutral grade is none', () => {
    close(applyMatrix(gradeMatrix(NEUTRAL_GRADE), SKIN), SKIN);
    expect(visualGradeMatrix([NEUTRAL_GRADE, undefined])).toBeNull();
  });

  it('exposure doubles per stop; contrast turns about mid grey; saturation keeps luma', () => {
    close(applyMatrix(gradeMatrix(grade({ exposure: 1 })), [0.2, 0.3, 0.4]), [0.4, 0.6, 0.8]);
    close(applyMatrix(gradeMatrix(grade({ contrast: 0.5 })), [0.5, 0.5, 0.5]), [0.5, 0.5, 0.5]);
    expect(applyMatrix(gradeMatrix(grade({ contrast: 0.5 })), [0.7, 0.7, 0.7])[0]).toBeCloseTo(0.8, 5);
    const grey = applyMatrix(gradeMatrix(grade({ saturation: -1 })), SKIN);
    close(grey, [luma(SKIN), luma(SKIN), luma(SKIN)]);
    const rich = applyMatrix(gradeMatrix(grade({ saturation: 0.5 })), SKIN);
    expect(luma(rich)).toBeCloseTo(luma(SKIN), 5);
    expect(rich[0] - rich[2]).toBeGreaterThan(SKIN[0] - SKIN[2]);
  });

  it('warm is redder and less blue, magenta less green, and each look moves colour its own way', () => {
    const warm = applyMatrix(gradeMatrix(grade({ temperature: 1 })), [0.5, 0.5, 0.5]);
    expect(warm[0]).toBeGreaterThan(0.5);
    expect(warm[2]).toBeLessThan(0.5);
    expect(applyMatrix(gradeMatrix(grade({ tint: 1 })), [0.5, 0.5, 0.5])[1]).toBeLessThan(0.5);
    const mono = applyMatrix(gradeMatrix(grade({ look: 'mono' })), SKIN);
    expect(mono[0]).toBeCloseTo(mono[2], 5);
    const halfMono = applyMatrix(gradeMatrix(grade({ look: 'mono', lookStrength: 0.5 })), SKIN);
    expect(halfMono[0] - halfMono[2]).toBeGreaterThan(0);
    expect(halfMono[0] - halfMono[2]).toBeLessThan(SKIN[0] - SKIN[2]);
    const faded = applyMatrix(gradeMatrix(grade({ look: 'faded' })), [0, 0, 0]);
    expect(faded[0]).toBeGreaterThan(0.05);
    for (const look of ['vivid', 'muted', 'warm', 'cool', 'vintage', 'cinematic'] as const)
      expect(applyMatrix(gradeMatrix(grade({ look })), SKIN)).not.toEqual(SKIN);
  });

  it('applies a clip’s grade, then the whole video’s, as one matrix', () => {
    const clip = grade({ exposure: 1 });
    const video = grade({ saturation: -1 });
    const both = visualGradeMatrix([clip, video])!;
    const step = applyMatrix(gradeMatrix(video), applyMatrix(gradeMatrix(clip), [0.2, 0.3, 0.1]));
    close(applyMatrix(both, [0.2, 0.3, 0.1]), step);
    expect(composeMatrices(IDENTITY_MATRIX, gradeMatrix(clip))).toEqual(gradeMatrix(clip));
  });

  it('writes feColorMatrix’s twenty values, alpha passed through', () => {
    const values = feColorMatrixValues(gradeMatrix(grade({ exposure: 1 }))).split(' ').map(Number);
    expect(values).toEqual([2, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 1, 0]);
  });
});
