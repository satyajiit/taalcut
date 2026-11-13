// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * How well a set of casting weights predicts the creator (LRN1-PREF eval), and whether the learner kept its promises.
 *
 * - The exam: slots of templates the learner never saw, cast with casting.v1's defaults so the shots shown don't
 *   depend on the weights under test. In each the creator ended with one of the four shown (the pick when they kept
 *   it). Top-1: the weights value that one highest. Pairwise: it over each other shown shot.
 * - Recorded swaps: the exam's slots where the creator swapped; the weights value the shot swapped in over the pick
 *   it replaced. The defaults made those picks, so they start near 0 here by construction: the exam is the fair test.
 * - Movement: L1 distance to the hidden weights brought inside the bounds (all the learner may reach).
 * - Bounds: every weight the learner wrote inside [default ÷ 2, default × 2], at the defaults' total.
 */
import {
  CASTING_WEIGHT_KEYS,
  castingWeightBounds,
  castingWeightTotal,
  CASTING_WEIGHT_UNITS,
  fitCastingWeights,
  type CastCandidate,
  type CastingWeights,
} from '@taalcut/core';
import { wilson } from '../gates/stats';
import { valueOf } from './creator';

export interface ExamSlot {
  /** The pick first, then the alternates, as casting scored them. */
  readonly shown: readonly Pick<CastCandidate, 'parts'>[];
  /** The one the creator ended with (0: they kept the pick). */
  readonly chosen: number;
}

export interface Accuracy {
  readonly correct: number;
  readonly total: number;
  readonly rate: number;
  /** Wilson 95% interval; null when there is nothing to score. */
  readonly interval: { readonly low: number; readonly high: number } | null;
}

export function accuracy(correct: number, total: number): Accuracy {
  return {
    correct,
    total,
    rate: total === 0 ? 0 : correct / total,
    interval: total === 0 ? null : wilson(Math.round(correct), total),
  };
}

/** Several runs' counts as one. */
export function pool(parts: readonly Accuracy[]): Accuracy {
  return accuracy(
    parts.reduce((sum, part) => sum + part.correct, 0),
    parts.reduce((sum, part) => sum + part.total, 0),
  );
}

/** The first shown shot the weights value highest. */
function favourite(weights: CastingWeights, slot: ExamSlot): number {
  let best = 0;
  slot.shown.forEach((candidate, index) => {
    const first = slot.shown[best];
    if (first && valueOf(weights, candidate) > valueOf(weights, first)) best = index;
  });
  return best;
}

export function topOne(weights: CastingWeights, slots: readonly ExamSlot[]): Accuracy {
  const correct = slots.filter((slot) => favourite(weights, slot) === slot.chosen).length;
  return accuracy(correct, slots.length);
}

/** The creator's shot over each other shown shot; a tie counts half. */
export function pairwise(weights: CastingWeights, slots: readonly ExamSlot[]): Accuracy {
  let correct = 0;
  let total = 0;
  for (const slot of slots) {
    const chosen = slot.shown[slot.chosen];
    if (!chosen) continue;
    slot.shown.forEach((other, index) => {
      if (index === slot.chosen) return;
      const margin = valueOf(weights, chosen) - valueOf(weights, other);
      total += 1;
      correct += margin > 0 ? 1 : margin === 0 ? 0.5 : 0;
    });
  }
  return accuracy(correct, total);
}

/** On the slots the creator swapped: the shot they swapped in over the pick it replaced. */
export function recordedSwaps(weights: CastingWeights, slots: readonly ExamSlot[]): Accuracy {
  const swapped = slots.filter((slot) => slot.chosen !== 0);
  let correct = 0;
  for (const slot of swapped) {
    const [pick] = slot.shown;
    const chosen = slot.shown[slot.chosen];
    if (!pick || !chosen) continue;
    const margin = valueOf(weights, chosen) - valueOf(weights, pick);
    correct += margin > 0 ? 1 : margin === 0 ? 0.5 : 0;
  }
  return accuracy(correct, swapped.length);
}

export function distance(a: CastingWeights, b: CastingWeights): number {
  const sum = CASTING_WEIGHT_KEYS.reduce((acc, key) => acc + Math.abs(a[key] - b[key]), 0);
  return Math.round(sum * CASTING_WEIGHT_UNITS) / CASTING_WEIGHT_UNITS;
}

/** The hidden weights brought inside the bounds: the nearest the learner is allowed to get. */
export function reachable(hidden: CastingWeights, defaults: CastingWeights): CastingWeights {
  return fitCastingWeights(hidden, defaults);
}

/**
 * The parts where the hidden weights sit at least `noticeable` from the defaults (inside the bounds), and whether
 * the learned weights moved the same way.
 */
export function directions(
  learned: CastingWeights,
  hidden: CastingWeights,
  defaults: CastingWeights,
  noticeable = 0.02,
): {
  readonly part: string;
  readonly wanted: 'up' | 'down';
  readonly moved: number;
  readonly agrees: boolean;
}[] {
  const target = reachable(hidden, defaults);
  return CASTING_WEIGHT_KEYS.filter((key) => Math.abs(target[key] - defaults[key]) >= noticeable).map(
    (key) => {
      const wanted = target[key] > defaults[key] ? 'up' : 'down';
      const moved = Math.round((learned[key] - defaults[key]) * CASTING_WEIGHT_UNITS) / CASTING_WEIGHT_UNITS;
      return { part: key, wanted, moved, agrees: wanted === 'up' ? moved > 0 : moved < 0 };
    },
  );
}

/** Inside every part's bounds, at the defaults' total, in whole thousandths. */
export function insideBounds(weights: CastingWeights, defaults: CastingWeights): boolean {
  const bounds = castingWeightBounds(defaults);
  const units = (value: number) => Math.round(value * CASTING_WEIGHT_UNITS);
  const whole = CASTING_WEIGHT_KEYS.every(
    (key) => Math.abs(weights[key] * CASTING_WEIGHT_UNITS - units(weights[key])) < 1e-6,
  );
  const within = CASTING_WEIGHT_KEYS.every(
    (key) => units(weights[key]) >= units(bounds[key].min) && units(weights[key]) <= units(bounds[key].max),
  );
  const total = CASTING_WEIGHT_KEYS.reduce((sum, key) => sum + units(weights[key]), 0);
  return whole && within && total === castingWeightTotal(defaults);
}
