// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The simulated creator (LRN1-PREF eval): hidden weights over casting's five score parts, the only thing that
 * separates one persona from another. Shown a slot's pick and its alternates as casting scored them, the creator
 * values each by the hidden weights plus Gumbel noise (a logit choice), swaps to the best when it beats the pick by
 * more than their margin, and removes a pick they value below `dropBelow` that nothing shown beats. Synthetic by
 * construction: real creators are a human input.
 */
import { CASTING_WEIGHT_KEYS, type CastCandidate, type CastingWeights, type SlotCast } from '@taalcut/core';

export interface Persona {
  readonly name: string;
  /** What they actually care about; the five add up to 1 (casting.v1's total) but may lie outside the bounds. */
  readonly hidden: CastingWeights;
  /** Scale of the Gumbel noise on each valuation: how inconsistent they are. */
  readonly noise: number;
  /** How much better a shot must look before they bother to swap. */
  readonly margin: number;
  /** A pick they value under this, with nothing shown better, is removed. */
  readonly dropBelow: number;
}

const persona = (name: string, hidden: CastingWeights): Persona => ({
  name,
  hidden,
  noise: 0.02,
  margin: 0.01,
  dropBelow: 0.66,
});

/** casting.v1's weights (packages/timeline/config/casting.v1.json). */
export const CASTING_V1_WEIGHTS: CastingWeights = {
  intent: 0.4,
  motion: 0.15,
  quality: 0.15,
  subject: 0.15,
  energy: 0.15,
};

/**
 * Four creators who each care most about one part, past where the bounds let the learner follow (0.35 against a
 * ceiling of 0.3), and one who casts as casting.v1 does: the learner should stay put for them.
 */
export const PERSONA = {
  motionFirst: persona('motion-first', {
    intent: 0.3,
    motion: 0.35,
    quality: 0.1,
    subject: 0.1,
    energy: 0.15,
  }),
  qualityFirst: persona('quality-first', {
    intent: 0.3,
    motion: 0.1,
    quality: 0.35,
    subject: 0.1,
    energy: 0.15,
  }),
  peopleFirst: persona('people-first', {
    intent: 0.3,
    motion: 0.1,
    quality: 0.15,
    subject: 0.35,
    energy: 0.1,
  }),
  energyFirst: persona('energy-first', {
    intent: 0.3,
    motion: 0.1,
    quality: 0.1,
    subject: 0.15,
    energy: 0.35,
  }),
  likeCastingV1: persona('like-casting-v1', CASTING_V1_WEIGHTS),
} as const satisfies Record<string, Persona>;

/** Every persona, in the order the report lists them. */
export const PERSONAS: readonly Persona[] = [
  PERSONA.motionFirst,
  PERSONA.qualityFirst,
  PERSONA.peopleFirst,
  PERSONA.energyFirst,
  PERSONA.likeCastingV1,
];

/** The value of a shot under some weights: the five parts as casting scored them, weighted. */
export function valueOf(weights: CastingWeights, candidate: Pick<CastCandidate, 'parts'>): number {
  return CASTING_WEIGHT_KEYS.reduce((sum, key) => sum + weights[key] * candidate.parts[key], 0);
}

export type Decision =
  | { readonly kind: 'keep' }
  | { readonly kind: 'swap'; readonly to: CastCandidate }
  | { readonly kind: 'drop' };

export interface Choice {
  /** What they do with the slot. */
  readonly decision: Decision;
  /** Which of the shown (pick first, then the alternates) they like best: the pick when they keep it. */
  readonly chosen: number;
}

function gumbel(random: () => number): number {
  const u = Math.min(1 - 1e-12, Math.max(1e-12, random()));
  return -Math.log(-Math.log(u));
}

/** What the creator does with one cast slot. A slot with no pick is left alone. */
export function decide(who: Persona, slot: SlotCast, random: () => number): Choice {
  if (!slot.pick) return { decision: { kind: 'keep' }, chosen: 0 };
  const shown = [slot.pick, ...slot.alternates];
  const values = shown.map((candidate) => valueOf(who.hidden, candidate) + who.noise * gumbel(random));
  let best = 0;
  values.forEach((value, index) => {
    if (value > (values[best] ?? value)) best = index;
  });
  const to = shown[best];
  const gain = (values[best] ?? 0) - (values[0] ?? 0);
  if (best !== 0 && to && gain > who.margin) return { decision: { kind: 'swap', to }, chosen: best };
  if (valueOf(who.hidden, slot.pick) < who.dropBelow) return { decision: { kind: 'drop' }, chosen: 0 };
  return { decision: { kind: 'keep' }, chosen: 0 };
}
