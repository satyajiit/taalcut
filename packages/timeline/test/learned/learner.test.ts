// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The learner: no movement below the minimum, toward what the pairs prefer, inside the bounds, and repeatable. */
import { castingWeightBounds, CASTING_WEIGHT_KEYS, type CastingWeights } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { CASTING_CONFIG } from '../../src/casting/config';
import { learnCastingWeights, pairMargin, type PreferencePair } from '../../src/casting/learned/learner';
import { LEARNER_CONFIG } from '../../src/casting/learned/learner-config';
import { random } from '../fixtures/library';
import { parts } from './log-fixture';

const defaults = CASTING_CONFIG.weights;
const tau = CASTING_CONFIG.confidence.tau;

/** Pairs where the chosen shot has more motion match and less subject match than the rejected one. */
function motionLover(count: number, seed = 3): PreferencePair[] {
  const next = random(seed);
  return Array.from({ length: count }, () => {
    const base = parts({
      intent: 0.4 + 0.2 * next(),
      quality: 0.5 + 0.2 * next(),
      energy: 0.4 + 0.3 * next(),
    });
    return {
      chosen: { ...base, motion: 1, subject: 0.2 + 0.1 * next(), intent: base.intent - 0.2 },
      rejected: { ...base, motion: 0, subject: 0.9 },
      weight: 1,
    };
  });
}

const inside = (weights: CastingWeights) => {
  const bounds = castingWeightBounds(defaults);
  return CASTING_WEIGHT_KEYS.every(
    (key) => weights[key] >= bounds[key].min - 1e-12 && weights[key] <= bounds[key].max + 1e-12,
  );
};

describe('learnCastingWeights', () => {
  it("doesn't move below the minimum evidence", () => {
    const learned = learnCastingWeights({
      start: defaults,
      defaults,
      pairs: motionLover(LEARNER_CONFIG.minEvidence - 1),
      tau,
    });
    expect(learned.moved).toBe(false);
    expect(learned.weights).toEqual(defaults);
  });

  it('moves toward what the pairs prefer and stays inside the bounds at the same total', () => {
    const pairs = motionLover(30);
    const learned = learnCastingWeights({ start: defaults, defaults, pairs, tau });
    expect(learned.moved).toBe(true);
    expect(learned.weights.motion).toBeGreaterThan(defaults.motion);
    expect(learned.weights.subject).toBeLessThan(defaults.subject);
    expect(inside(learned.weights)).toBe(true);
    expect(CASTING_WEIGHT_KEYS.reduce((sum, key) => sum + learned.weights[key], 0)).toBeCloseTo(1, 9);
    const agree = (weights: CastingWeights) => pairs.filter((pair) => pairMargin(weights, pair) > 0).length;
    expect(agree(learned.weights)).toBeGreaterThan(agree(defaults));
  });

  it('moves further with more pairs, but never past the bounds', () => {
    const few = learnCastingWeights({ start: defaults, defaults, pairs: motionLover(12), tau }).weights;
    const many = learnCastingWeights({ start: defaults, defaults, pairs: motionLover(400), tau }).weights;
    expect(many.motion).toBeGreaterThan(few.motion);
    expect(inside(many)).toBe(true);
    expect(many.motion).toBeLessThanOrEqual(castingWeightBounds(defaults).motion.max);
  });

  it('gives the same weights for the same pairs, byte for byte', () => {
    const pairs = motionLover(25, 9);
    const once = JSON.stringify(learnCastingWeights({ start: defaults, defaults, pairs, tau }));
    const again = JSON.stringify(
      learnCastingWeights({ start: defaults, defaults, pairs: pairs.map((pair) => ({ ...pair })), tau }),
    );
    expect(again).toBe(once);
  });

  it('starts from (and is pulled back toward) an edited start', () => {
    const start = { intent: 0.3, motion: 0.15, quality: 0.25, subject: 0.15, energy: 0.15 };
    const learned = learnCastingWeights({ start, defaults, pairs: motionLover(12), tau });
    expect(learned.weights.quality).toBeGreaterThan(defaults.quality);
  });
});
