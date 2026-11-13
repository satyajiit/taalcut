// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Core's rules for a casting-weights item (LRN1-PREF), bound to its defaults, for the kit's CastingWeightsItem, which
 * imports no core code (PRD 6.2): the five parts in core's order, how far each can go, core's fit when a person
 * moves one, and core's lean for the sentence. So the editor bounds, shares and describes the weights exactly as the
 * learner and the library do.
 */
import {
  castingWeightBounds,
  castingWeightsLean,
  castingWeightTotal,
  CASTING_WEIGHT_KEYS,
  CASTING_WEIGHT_UNITS,
  fitCastingWeights,
  type CastingWeightBound,
  type CastingWeightKey,
  type CastingWeights,
} from '@taalcut/core';
import type { CastingWeightReach, CastingWeightsRules } from '@taalcut/ui';

/**
 * How far each weight can go while the five keep the defaults' total: its own bounds, narrowed by what the other
 * four can give or take (0.4 → 0.2 … 0.7 for casting.v1's description weight, since the others can't drop under
 * 0.3 together).
 */
export function castingWeightReach(defaults: CastingWeights): CastingWeightReach {
  const bounds = castingWeightBounds(defaults);
  const total = castingWeightTotal(defaults);
  const units = (value: number) => Math.round(value * CASTING_WEIGHT_UNITS);
  const sumOthers = (key: CastingWeightKey, end: 'min' | 'max') =>
    CASTING_WEIGHT_KEYS.filter((other) => other !== key).reduce(
      (sum, other) => sum + units(bounds[other][end]),
      0,
    );
  const reach = (key: CastingWeightKey): CastingWeightBound => ({
    min: Math.max(units(bounds[key].min), total - sumOthers(key, 'max')) / CASTING_WEIGHT_UNITS,
    max: Math.min(units(bounds[key].max), total - sumOthers(key, 'min')) / CASTING_WEIGHT_UNITS,
  });
  return {
    intent: reach('intent'),
    motion: reach('motion'),
    quality: reach('quality'),
    subject: reach('subject'),
    energy: reach('energy'),
  };
}

export function castingWeightsRules(defaults: CastingWeights): CastingWeightsRules {
  return {
    parts: CASTING_WEIGHT_KEYS,
    reach: castingWeightReach(defaults),
    units: CASTING_WEIGHT_UNITS,
    fit: (weights, hold) => fitCastingWeights(weights, defaults, hold),
    lean: (weights) => castingWeightsLean(weights, defaults),
  };
}
