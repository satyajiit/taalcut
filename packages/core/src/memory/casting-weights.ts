// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Learned casting weights (LRN1-PREF), the `casting-weights` memory item's meaning: their bounds around the casting
 * config's own weights, the one way any weights are brought inside them, and the plain sentence that says how they
 * lean. @taalcut/timeline's learner and config resolution and Settings → Memory's editor (ui, renderer) all use
 * these, so an item means the same thing wherever it is read or written.
 *
 * Bounds: each weight stays within [default ÷ 2, default × 2], and the five add up to the defaults' total, the
 * scale the engine's penalties and hook bonus are tuned against. Stored weights are whole thousandths.
 */

export const CASTING_WEIGHT_KEYS = ['intent', 'motion', 'quality', 'subject', 'energy'] as const;
export type CastingWeightKey = (typeof CASTING_WEIGHT_KEYS)[number];
export type CastingWeights = { readonly [K in CastingWeightKey]: number };

/** A learned or edited weight stays within [default ÷ SPREAD, default × SPREAD]. */
export const CASTING_WEIGHT_SPREAD = 2;
/** Weights are kept in whole steps of 1 / CASTING_WEIGHT_UNITS (thousandths). */
export const CASTING_WEIGHT_UNITS = 1000;
/** A part counts as leaned toward (or away from) at this share above (or below) its default. */
const NOTICEABLE = 0.1;
/** Halving steps when solving for the shift that meets the total: far below a thousandth. */
const BISECTIONS = 80;

export interface CastingWeightBound {
  readonly min: number;
  readonly max: number;
}
export type CastingWeightBounds = { readonly [K in CastingWeightKey]: CastingWeightBound };

type Units = Record<CastingWeightKey, number>;

const toUnits = (value: number) => Math.round(value * CASTING_WEIGHT_UNITS);
const fromUnits = (units: number) => units / CASTING_WEIGHT_UNITS;

function mapKeys(fn: (key: CastingWeightKey) => number): Units {
  return {
    intent: fn('intent'),
    motion: fn('motion'),
    quality: fn('quality'),
    subject: fn('subject'),
    energy: fn('energy'),
  };
}

function boundUnits(defaults: CastingWeights): { min: Units; max: Units } {
  return {
    min: mapKeys((key) => Math.ceil(toUnits(defaults[key]) / CASTING_WEIGHT_SPREAD)),
    max: mapKeys((key) => toUnits(defaults[key]) * CASTING_WEIGHT_SPREAD),
  };
}

/** Each weight's range around the defaults, in weight units (0.15 → 0.075 … 0.3). */
export function castingWeightBounds(defaults: CastingWeights): CastingWeightBounds {
  const { min, max } = boundUnits(defaults);
  const bound = (key: CastingWeightKey) => ({ min: fromUnits(min[key]), max: fromUnits(max[key]) });
  return {
    intent: bound('intent'),
    motion: bound('motion'),
    quality: bound('quality'),
    subject: bound('subject'),
    energy: bound('energy'),
  };
}

/** The defaults' total, in units. */
export function castingWeightTotal(defaults: CastingWeights): number {
  return CASTING_WEIGHT_KEYS.reduce((sum, key) => sum + toUnits(defaults[key]), 0);
}

const clampTo = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/**
 * The nearest point (least squares) to `target` inside the bounds whose sum is `total`: every value shifted by one
 * amount, then clamped. The shift is found by bisection, so the same input always gives the same output.
 */
export function projectToBounds(
  target: readonly number[],
  low: readonly number[],
  high: readonly number[],
  total: number,
): number[] {
  const sum = (shift: number) =>
    target.reduce((acc, value, index) => acc + clampTo(value - shift, low[index] ?? 0, high[index] ?? 0), 0);
  let below = Math.min(...target.map((value, index) => value - (high[index] ?? 0)));
  let above = Math.max(...target.map((value, index) => value - (low[index] ?? 0)));
  for (let step = 0; step < BISECTIONS; step++) {
    const middle = (below + above) / 2;
    if (sum(middle) > total) below = middle;
    else above = middle;
  }
  const shift = (below + above) / 2;
  return target.map((value, index) => clampTo(value - shift, low[index] ?? 0, high[index] ?? 0));
}

/** Whole units that keep the total: floors, then one more unit to the largest remainders (ties in key order). */
function roundKeepingTotal(values: readonly number[], total: number): number[] {
  const floors = values.map((value) => Math.floor(value + 1e-9));
  let missing = total - floors.reduce((acc, value) => acc + value, 0);
  const order = values
    .map((value, index) => ({ index, rest: value - (floors[index] ?? 0) }))
    .sort((a, b) => b.rest - a.rest || a.index - b.index);
  for (const { index } of order) {
    if (missing <= 0) break;
    floors[index] = (floors[index] ?? 0) + 1;
    missing--;
  }
  return floors;
}

/**
 * Any weights brought inside the bounds with the defaults' total, in whole thousandths: the learner's result, an
 * edit, or an item written elsewhere. `hold` is the weight a person just set: it keeps its value as far as the
 * others' bounds allow, and the others share the rest. Weights already inside come back unchanged.
 */
export function fitCastingWeights(
  weights: CastingWeights,
  defaults: CastingWeights,
  hold?: CastingWeightKey,
): CastingWeights {
  const { min, max } = boundUnits(defaults);
  const total = castingWeightTotal(defaults);
  const keys = [...CASTING_WEIGHT_KEYS];
  const units: Units = mapKeys(() => 0);
  let rest = keys;
  let left = total;
  if (hold) {
    const others = keys.filter((key) => key !== hold);
    const room = (bounds: Units) => others.reduce((acc, key) => acc + bounds[key], 0);
    const held = clampTo(
      toUnits(weights[hold]),
      Math.max(min[hold], total - room(max)),
      Math.min(max[hold], total - room(min)),
    );
    units[hold] = held;
    rest = others;
    left = total - held;
  }
  const projected = projectToBounds(
    rest.map((key) => weights[key] * CASTING_WEIGHT_UNITS),
    rest.map((key) => min[key]),
    rest.map((key) => max[key]),
    left,
  );
  roundKeepingTotal(projected, left).forEach((value, index) => {
    units[rest[index] as CastingWeightKey] = value;
  });
  return mapKeys((key) => fromUnits(units[key]));
}

/** Whether two sets of weights are the same to the stored unit. */
export function sameCastingWeights(a: CastingWeights, b: CastingWeights): boolean {
  return CASTING_WEIGHT_KEYS.every((key) => toUnits(a[key]) === toUnits(b[key]));
}

const LEANS_TOWARD: Readonly<Record<CastingWeightKey, string>> = {
  intent: 'shots that match what the slot describes',
  motion: 'shots whose camera motion matches the template',
  quality: 'sharp, well-exposed shots',
  subject: 'shots with the people and subject the slot asks for',
  energy: 'shots whose energy matches the music',
};
const LESS_ON: Readonly<Record<CastingWeightKey, string>> = {
  intent: 'matching the description',
  motion: 'matching camera motion',
  quality: 'picture quality',
  subject: 'matching people and subject',
  energy: 'matching energy',
};

function listed(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/**
 * The parts that lean toward and away from their defaults by at least a tenth, the strongest first (ties in key
 * order): what the sentence names, and what a localised view (Settings → Memory) names in the reader's language.
 */
export function castingWeightsLean(
  weights: CastingWeights,
  defaults: CastingWeights,
): { readonly toward: readonly CastingWeightKey[]; readonly less: readonly CastingWeightKey[] } {
  const ratio = (key: CastingWeightKey) => (defaults[key] > 0 ? weights[key] / defaults[key] : 1);
  const keys = [...CASTING_WEIGHT_KEYS];
  const toward = keys
    .filter((key) => ratio(key) >= 1 + NOTICEABLE)
    .sort((a, b) => ratio(b) - ratio(a) || keys.indexOf(a) - keys.indexOf(b));
  const less = keys
    .filter((key) => ratio(key) <= 1 - NOTICEABLE)
    .sort((a, b) => ratio(a) - ratio(b) || keys.indexOf(a) - keys.indexOf(b));
  return { toward, less };
}

/**
 * One plain sentence on how the weights lean against the defaults, the item's text: English, like every learned
 * item, for the agent's prompt and memory search. Settings shows the lean in the reader's language from the item's
 * data (castingWeightsLean). Parts within a tenth of their default aren't named.
 */
export function castingWeightsText(weights: CastingWeights, defaults: CastingWeights): string {
  const lean = castingWeightsLean(weights, defaults);
  const toward = listed(lean.toward.map((key) => LEANS_TOWARD[key]));
  const less = listed(lean.less.map((key) => LESS_ON[key]));
  if (lean.toward.length > 0 && lean.less.length > 0) return `Leans toward ${toward}; less on ${less}.`;
  if (lean.toward.length > 0) return `Leans toward ${toward}.`;
  if (lean.less.length > 0) return `Puts less weight on ${less}.`;
  return 'Casts with the default balance of description, motion, quality, subject and energy.';
}
