// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Settings → Memory's casting weights (LRN1-PREF, timeline SPEC "Learned casting preferences"): which item carries
 * them, and the memory.update patch for weights a person set. The weights are fitted the one way core fits any
 * (inside their bounds, at the defaults' total, whole thousandths), the text is core's English sentence for them,
 * and `pairs` is 0: no learned choices are behind them, and the learner starts from them next time.
 */
import {
  castingWeightsText,
  fitCastingWeights,
  sameCastingWeights,
  type CastingWeights,
  type MemoryItemView,
} from '@taalcut/core';
import type { CastingWeightsData } from '@taalcut/ui';

/** The item's casting weights, or null for any other item. */
export function castingWeightsOf(item: Pick<MemoryItemView, 'data'>): CastingWeightsData | null {
  return item.data?.kind === 'casting-weights' ? item.data : null;
}

/** What memory.update changes for these weights; null when they are the item's already. */
export function castingWeightsPatch(
  data: CastingWeightsData,
  weights: CastingWeights,
): { text: string; data: CastingWeightsData } | null {
  const fitted = fitCastingWeights(weights, data.defaults);
  if (sameCastingWeights(fitted, data.weights)) return null;
  return {
    text: castingWeightsText(fitted, data.defaults),
    data: { ...data, weights: fitted, pairs: 0 },
  };
}
