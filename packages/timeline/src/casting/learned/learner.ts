// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The learner (SPEC, "Learned casting preferences"): a bounded update of casting's five weights from "chosen over
 * rejected" pairs. A pairwise logistic model, P(chosen) = σ(β · w · (chosen − rejected)) with β = 1 / τ (the
 * casting config's confidence squash: a score margin of τ is one logit), fitted by projected gradient descent with a
 * pull toward the starting weights, inside the bounds and at the defaults' total. Pure and deterministic: the same
 * pairs in the same order give the same weights, to the bit.
 */
import {
  CASTING_WEIGHT_KEYS,
  castingWeightBounds,
  castingWeightTotal,
  CASTING_WEIGHT_UNITS,
  fitCastingWeights,
  projectToBounds,
  type CastingWeights,
} from '@taalcut/core';
import { LEARNER_CONFIG, type LearnerConfig } from './learner-config';

/** One shot's five score parts, as casting scored them. */
export type ScoreParts = CastingWeights;

export interface PreferencePair {
  readonly chosen: ScoreParts;
  readonly rejected: ScoreParts;
  /** How much the pair counts (learner config `pairWeight`). */
  readonly weight: number;
}

export interface LearnInput {
  /** Where learning starts and what it is pulled back toward: the defaults, or the creator's last edit. */
  readonly start: CastingWeights;
  /** The casting config's own weights: the bounds and the total. */
  readonly defaults: CastingWeights;
  readonly pairs: readonly PreferencePair[];
  /** The casting config's `confidence.tau`. */
  readonly tau: number;
}

export interface Learned {
  readonly weights: CastingWeights;
  /** False while the pairs weigh less than the config's minimum: the weights are the start. */
  readonly moved: boolean;
  /** The pairs' total weight. */
  readonly evidence: number;
}

const vector = (parts: ScoreParts) => CASTING_WEIGHT_KEYS.map((key) => parts[key]);
/** Back from CASTING_WEIGHT_KEYS order. */
const toWeights = (values: readonly number[]): CastingWeights => ({
  intent: values[0] ?? 0,
  motion: values[1] ?? 0,
  quality: values[2] ?? 0,
  subject: values[3] ?? 0,
  energy: values[4] ?? 0,
});
const dot = (a: readonly number[], b: readonly number[]) =>
  a.reduce((acc, value, i) => acc + value * (b[i] ?? 0), 0);

/** w · (chosen − rejected): above zero, the weights prefer the chosen shot. */
export function pairMargin(
  weights: CastingWeights,
  pair: Pick<PreferencePair, 'chosen' | 'rejected'>,
): number {
  const w = vector(weights);
  const chosen = vector(pair.chosen);
  const rejected = vector(pair.rejected);
  return dot(
    w,
    chosen.map((value, i) => value - (rejected[i] ?? 0)),
  );
}

export function learnCastingWeights(input: LearnInput, config: LearnerConfig = LEARNER_CONFIG): Learned {
  const evidence = input.pairs.reduce((acc, pair) => acc + pair.weight, 0);
  const start = fitCastingWeights(input.start, input.defaults);
  if (evidence < config.minEvidence) return { weights: start, moved: false, evidence };

  const beta = 1 / input.tau;
  const scale = vector(input.defaults);
  const anchor = vector(start);
  const bounds = castingWeightBounds(input.defaults);
  const low = CASTING_WEIGHT_KEYS.map((key) => bounds[key].min);
  const high = CASTING_WEIGHT_KEYS.map((key) => bounds[key].max);
  const total = castingWeightTotal(input.defaults) / CASTING_WEIGHT_UNITS;
  const diffs = input.pairs.map((pair) => {
    const chosen = vector(pair.chosen);
    const rejected = vector(pair.rejected);
    return { d: chosen.map((value, i) => value - (rejected[i] ?? 0)), weight: pair.weight };
  });

  // 1 / Lipschitz bound of the gradient: σ' ≤ 1/4 for the data, κ / default² for the pull.
  const curvature =
    (beta * beta * diffs.reduce((acc, { d, weight }) => acc + weight * dot(d, d), 0)) / 4 +
    config.prior / Math.min(...scale.map((value) => value * value));
  const rate = 1 / curvature;

  let w = anchor;
  for (let step = 0; step < config.steps; step++) {
    const gradient = w.map((value, k) => (config.prior * (value - (anchor[k] ?? 0))) / (scale[k] ?? 1) ** 2);
    for (const { d, weight } of diffs) {
      // d/dw of weight · log(1 + exp(−β w·d)) = −weight · β · σ(−β w·d) · d
      const push = (weight * beta) / (1 + Math.exp(beta * dot(w, d)));
      for (let k = 0; k < gradient.length; k++) gradient[k] = (gradient[k] ?? 0) - push * (d[k] ?? 0);
    }
    w = projectToBounds(
      w.map((value, k) => value - rate * (gradient[k] ?? 0)),
      low,
      high,
      total,
    );
  }
  return { weights: fitCastingWeights(toWeights(w), input.defaults), moved: true, evidence };
}
