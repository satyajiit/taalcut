// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The duplicate thresholds per image-token budget (IX2-E2): 280 keeps the G25 fit, and 140 and 70 are 280's moved by
 * how much each budget shrinks the distance between two frames, measured on the generated labelled set
 * (scripts/study-duplicates.ts: ×0.889 at 140, ×0.830 at 70). So a pair keeps its decision when only the budget
 * changes. The live burst, per budget, is test/integration/duplicates.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { duplicateThresholds, isSameMoment } from '../../src/analysis/duplicates';

const SCALE = { 140: 0.889, 70: 0.8298 } as const;

/** A 280 similarity as the same pair measures at `budget`. */
const at = (budget: 140 | 70, similarity280: number) => 1 - SCALE[budget] * (1 - similarity280);

describe('duplicateThresholds', () => {
  it("keeps 280's G25 fit, and moves each threshold by the budget's distance scale", () => {
    const base = duplicateThresholds(280);
    expect(base).toEqual({ cosine: 0.92, cosineAlone: 0.96, cosineWithSameHash: 0.85 });
    for (const budget of [140, 70] as const) {
      const moved = duplicateThresholds(budget);
      expect(moved.cosine).toBeCloseTo(at(budget, base.cosine), 3);
      expect(moved.cosineAlone).toBeCloseTo(at(budget, base.cosineAlone), 3);
      expect(moved.cosineWithSameHash).toBeCloseTo(at(budget, base.cosineWithSameHash), 3);
    }
  });

  it('decides the measured burst pairs the same at every budget', () => {
    // At 280 (vision config): the blurred twin of a burst 0.86 with a near-identical dHash, sharp takes 0.98 with an
    // agreeing one, other shots 0.70–0.79 with distant ones.
    const pairs = [
      { similarity: 0.86, bits: 4, same: true },
      { similarity: 0.98, bits: 9, same: true },
      { similarity: 0.79, bits: 30, same: false },
      { similarity: 0.7, bits: 5, same: false },
    ];
    for (const pair of pairs) {
      expect(isSameMoment(pair.similarity, pair.bits, duplicateThresholds(280))).toBe(pair.same);
      for (const budget of [140, 70] as const) {
        expect(isSameMoment(at(budget, pair.similarity), pair.bits, duplicateThresholds(budget))).toBe(
          pair.same,
        );
      }
    }
  });
});
