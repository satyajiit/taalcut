// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the casting weights' item and editor need of core's rules for them (LRN1-PREF), bound to the item's defaults.
 * The kit imports no core code (PRD 6.2), so the caller supplies them: Settings → Memory builds them from core's
 * castingWeightBounds, fitCastingWeights and castingWeightsLean (apps/renderer casting-weights-rules.ts), so the
 * editor bounds, shares and describes the weights exactly as the learner and the library do.
 */
import type { CastingWeightBound, CastingWeightKey, CastingWeights } from '@taalcut/core';

/** The parts noticeably above and below their default, the strongest first. */
export interface CastingWeightsLean {
  readonly toward: readonly CastingWeightKey[];
  readonly less: readonly CastingWeightKey[];
}

/** How far each part can go while the five keep the defaults' total. */
export type CastingWeightReach = { readonly [K in CastingWeightKey]: CastingWeightBound };

export interface CastingWeightsRules {
  /** The five parts, in the order the editor lists them. */
  readonly parts: readonly CastingWeightKey[];
  readonly reach: CastingWeightReach;
  /** Stored steps per whole weight (core's CASTING_WEIGHT_UNITS: thousandths), the sliders' step. */
  readonly units: number;
  /** The weights inside their bounds at the defaults' total, `hold` kept where the person put it as far as it can be. */
  fit(weights: CastingWeights, hold: CastingWeightKey): CastingWeights;
  lean(weights: CastingWeights): CastingWeightsLean;
}
