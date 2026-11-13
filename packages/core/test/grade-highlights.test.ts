// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import { gradePatchSchema, gradeSchema, isNeutralGrade, NEUTRAL_GRADE } from '../src/index';

describe('highlight and white adjustments', () => {
  it('reads older grades without adding adjustments or changing their neutral meaning', () => {
    const grade = gradeSchema.parse(NEUTRAL_GRADE);
    expect(grade).toEqual(NEUTRAL_GRADE);
    expect(isNeutralGrade(grade)).toBe(true);
    expect(isNeutralGrade({ ...grade, highlights: 0, whites: 0 })).toBe(true);
  });

  it.each(['highlights', 'whites'] as const)('retains a %s-only edit and accepts a reset', (field) => {
    for (const value of [-1, -0.4, 1]) {
      const patch = gradePatchSchema.parse({ [field]: value });
      expect(patch).toEqual({ [field]: value });
      expect(isNeutralGrade({ ...NEUTRAL_GRADE, ...patch })).toBe(false);
    }
    expect(gradePatchSchema.parse({ [field]: 0 })).toEqual({ [field]: 0 });
    for (const value of [-1.01, 1.01, NaN, Infinity, '0.5', null]) {
      expect(gradePatchSchema.safeParse({ [field]: value }).success).toBe(false);
    }
  });
});
