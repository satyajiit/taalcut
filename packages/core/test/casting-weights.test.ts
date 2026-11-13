// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** LRN1-PREF: the learned casting weights' bounds, the one fit every writer uses, and the item's sentence. */
import { describe, expect, it } from 'vitest';
import {
  CASTING_WEIGHT_KEYS,
  castingWeightBounds,
  castingWeightsLean,
  castingWeightsText,
  fitCastingWeights,
  projectToBounds,
  type CastingWeights,
} from '../src/memory/casting-weights';

/** casting.v1's weights (timeline's config/casting.v1.json). */
const defaults = { intent: 0.4, motion: 0.15, quality: 0.15, subject: 0.15, energy: 0.15 };

/** mulberry32, so the property runs are the same every time. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), state | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const total = (weights: CastingWeights) =>
  CASTING_WEIGHT_KEYS.reduce((sum, key) => sum + weights[key] * 1000, 0);
const inside = (weights: CastingWeights) => {
  const bounds = castingWeightBounds(defaults);
  return CASTING_WEIGHT_KEYS.every(
    (key) => weights[key] >= bounds[key].min && weights[key] <= bounds[key].max,
  );
};
const thousandths = (weights: CastingWeights) =>
  CASTING_WEIGHT_KEYS.every((key) => Number.isInteger(Math.round(weights[key] * 1e6) / 1000));

describe('castingWeightBounds', () => {
  it('halves and doubles casting.v1', () => {
    expect(castingWeightBounds(defaults)).toEqual({
      intent: { min: 0.2, max: 0.8 },
      motion: { min: 0.075, max: 0.3 },
      quality: { min: 0.075, max: 0.3 },
      subject: { min: 0.075, max: 0.3 },
      energy: { min: 0.075, max: 0.3 },
    });
  });
});

describe('fitCastingWeights', () => {
  it('keeps weights already inside', () => {
    expect(fitCastingWeights(defaults, defaults)).toEqual(defaults);
    const leaning = { intent: 0.35, motion: 0.25, quality: 0.15, subject: 0.1, energy: 0.15 };
    expect(fitCastingWeights(leaning, defaults)).toEqual(leaning);
  });

  it('brings any weights inside the bounds at the defaults total, in thousandths', () => {
    const next = random(7);
    for (let run = 0; run < 200; run++) {
      const wild = {
        intent: next() * 5,
        motion: next() * 5,
        quality: next(),
        subject: next() * 0.01,
        energy: next() * 2,
      };
      const fitted = fitCastingWeights(wild, defaults);
      expect(inside(fitted)).toBe(true);
      expect(total(fitted)).toBeCloseTo(1000, 6);
      expect(thousandths(fitted)).toBe(true);
    }
  });

  it('holds the weight a person just set and shares the rest', () => {
    const fitted = fitCastingWeights({ ...defaults, motion: 0.27 }, defaults, 'motion');
    expect(fitted.motion).toBe(0.27);
    expect(total(fitted)).toBeCloseTo(1000, 6);
    expect(fitted.intent).toBeLessThan(defaults.intent);
  });

  it('holds a weight only as far as the bounds allow', () => {
    expect(fitCastingWeights({ ...defaults, motion: 0.9 }, defaults, 'motion').motion).toBe(0.3);
    expect(fitCastingWeights({ ...defaults, intent: 0 }, defaults, 'intent').intent).toBe(0.2);
  });
});

describe('projectToBounds', () => {
  it('is the nearest point: an equal shift, then the clamps', () => {
    expect(projectToBounds([0.5, 0.5], [0, 0], [1, 1], 0.6).map((v) => Number(v.toFixed(9)))).toEqual([
      0.3, 0.3,
    ]);
    expect(projectToBounds([2, 0], [0, 0.25], [1, 1], 1).map((v) => Number(v.toFixed(9)))).toEqual([
      0.75, 0.25,
    ]);
  });
});

describe('castingWeightsText', () => {
  it('names what it leans toward and away from', () => {
    const weights = { intent: 0.4, motion: 0.24, quality: 0.15, subject: 0.06 + 0.03, energy: 0.12 };
    expect(castingWeightsText(weights, defaults)).toBe(
      'Leans toward shots whose camera motion matches the template; less on matching people and subject and matching energy.',
    );
  });

  it('lists the lean as keys for a localised view, strongest first', () => {
    const weights = { intent: 0.4, motion: 0.24, quality: 0.15, subject: 0.09, energy: 0.12 };
    expect(castingWeightsLean(weights, defaults)).toEqual({
      toward: ['motion'],
      less: ['subject', 'energy'],
    });
    expect(castingWeightsLean(defaults, defaults)).toEqual({ toward: [], less: [] });
  });

  it('says so when nothing moved by a tenth', () => {
    expect(castingWeightsText({ ...defaults, motion: 0.16, energy: 0.14 }, defaults)).toBe(
      'Casts with the default balance of description, motion, quality, subject and energy.',
    );
    expect(castingWeightsText({ ...defaults, intent: 0.5, quality: 0.1, energy: 0.1 }, defaults)).toBe(
      'Leans toward shots that match what the slot describes; less on picture quality and matching energy.',
    );
    expect(castingWeightsText({ ...defaults, intent: 0.3, motion: 0.25 }, defaults)).toBe(
      'Leans toward shots whose camera motion matches the template; less on matching the description.',
    );
  });
});
