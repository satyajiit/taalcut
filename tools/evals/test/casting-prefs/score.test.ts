// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The casting-preferences scorers (LRN1-PREF) on hand-computed slots. */
import type { CastingWeights } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { CASTING_V1_WEIGHTS } from '../../src/casting-prefs/creator';
import {
  directions,
  distance,
  insideBounds,
  pairwise,
  pool,
  reachable,
  recordedSwaps,
  topOne,
  type ExamSlot,
} from '../../src/casting-prefs/score';

const shot = (over: Partial<CastingWeights>) => ({
  parts: {
    intent: 0.5,
    motion: 0.5,
    quality: 0.5,
    subject: 0.5,
    energy: 0.5,
    hook: null,
    rerank: null,
    penalty: 0,
    ...over,
  },
});
const MOTION: CastingWeights = { intent: 0.2, motion: 0.5, quality: 0.1, subject: 0.1, energy: 0.1 };

/** Pick: strong on the description; alternate 1: strong on motion; alternate 2: plain. */
const swappedToMotion: ExamSlot = {
  shown: [shot({ intent: 0.9, motion: 0 }), shot({ intent: 0.5, motion: 1 }), shot({})],
  chosen: 1,
};
const keptPick: ExamSlot = { shown: [shot({ intent: 0.9, motion: 1 }), shot({ intent: 0.2 })], chosen: 0 };

describe('casting-preferences scorers (LRN1-PREF)', () => {
  it('top-1: the shot the weights value most is the one the creator ended with', () => {
    expect(topOne(CASTING_V1_WEIGHTS, [swappedToMotion, keptPick])).toMatchObject({
      correct: 1,
      total: 2,
      rate: 0.5,
    });
    expect(topOne(MOTION, [swappedToMotion, keptPick])).toMatchObject({ correct: 2, total: 2, rate: 1 });
    expect(topOne(MOTION, []).interval).toBeNull();
  });

  it('pairwise: the creator’s shot over each other shown, a tie counting half', () => {
    // casting.v1: swapped slot, chosen 0.4·0.5+0.15·1+… vs pick 0.4·0.9+0 …: loses to the pick, beats the plain one.
    expect(pairwise(CASTING_V1_WEIGHTS, [swappedToMotion])).toMatchObject({ correct: 1, total: 2 });
    const tie: ExamSlot = { shown: [shot({}), shot({})], chosen: 1 };
    expect(pairwise(MOTION, [tie])).toMatchObject({ correct: 0.5, total: 1 });
  });

  it('recorded swaps: only swapped slots, the shot swapped in over the pick it replaced', () => {
    expect(recordedSwaps(CASTING_V1_WEIGHTS, [swappedToMotion, keptPick])).toMatchObject({
      correct: 0,
      total: 1,
    });
    expect(recordedSwaps(MOTION, [swappedToMotion, keptPick])).toMatchObject({ correct: 1, total: 1 });
  });

  it('pools runs by their counts, with a Wilson interval', () => {
    const pooled = pool([
      topOne(MOTION, [swappedToMotion]),
      topOne(CASTING_V1_WEIGHTS, [swappedToMotion, keptPick]),
    ]);
    expect(pooled).toMatchObject({ correct: 2, total: 3 });
    expect(pooled.interval?.low).toBeLessThan(2 / 3);
    expect(pooled.interval?.high).toBeGreaterThan(2 / 3);
  });

  it('distance, reach and direction against the hidden weights brought inside the bounds', () => {
    const hidden: CastingWeights = { intent: 0.3, motion: 0.35, quality: 0.1, subject: 0.1, energy: 0.15 };
    const target = reachable(hidden, CASTING_V1_WEIGHTS);
    expect(target.motion).toBe(0.3);
    expect(insideBounds(target, CASTING_V1_WEIGHTS)).toBe(true);
    expect(distance(CASTING_V1_WEIGHTS, CASTING_V1_WEIGHTS)).toBe(0);
    const moved: CastingWeights = { intent: 0.36, motion: 0.2, quality: 0.13, subject: 0.15, energy: 0.16 };
    expect(directions(moved, hidden, CASTING_V1_WEIGHTS)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ part: 'motion', wanted: 'up', agrees: true }),
        expect.objectContaining({ part: 'intent', wanted: 'down', agrees: true }),
      ]),
    );
  });

  it('inside the bounds means every part in its range, whole thousandths, at the total', () => {
    expect(insideBounds(CASTING_V1_WEIGHTS, CASTING_V1_WEIGHTS)).toBe(true);
    expect(insideBounds({ ...CASTING_V1_WEIGHTS, motion: 0.31, intent: 0.24 }, CASTING_V1_WEIGHTS)).toBe(
      false,
    );
    expect(insideBounds({ ...CASTING_V1_WEIGHTS, motion: 0.16 }, CASTING_V1_WEIGHTS)).toBe(false);
    expect(insideBounds({ ...CASTING_V1_WEIGHTS, motion: 0.1505, intent: 0.3995 }, CASTING_V1_WEIGHTS)).toBe(
      false,
    );
  });
});
