// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A ducking envelope as an FFmpeg `volume` expression (P3-V6, SPEC P3.9). The planner gives gain points in
 * dB, linear in dB between them; between two points the gain is 10^(dB/20) with dB a straight line in time,
 * which is exp(a + b·t) with a and b precomputed here, so FFmpeg evaluates one exponential per audio frame
 * and nothing else. A balanced `if` tree over the points keeps the expression's depth at log n (FFmpeg's
 * parser recurses), as the speed filters do. Before the first point and after the last the gain holds.
 */
import type { GainPoint } from '@taalcut/core';
import { balancedIf, exprDecimal } from '../plan/filter-expression';
import { MIX_SAMPLE_RATE } from './mix-types';

/** dB to the exponent of a linear gain: 10^(dB/20) = exp(dB · ln 10 / 20). */
const NEPER_PER_DB = Math.LN10 / 20;

const decimal = (value: number) => exprDecimal(value, 12);

interface Knot {
  readonly t: number;
  readonly db: number;
}

const held = (db: number) => `exp(${decimal(db * NEPER_PER_DB)})`;

/**
 * Leaf `index` of the n + 1 leaves: leaf 0 holds the first knot's gain before it; leaf i ≥ 1 runs from knot
 * i − 1 to knot i (the last one holds after the last knot).
 */
function leaf(knots: readonly Knot[], index: number): string {
  const from = knots[Math.max(0, index - 1)];
  if (!from) return '1';
  const to = index === 0 ? undefined : knots[index];
  if (!to || to.t <= from.t || to.db === from.db) return held(from.db);
  const slope = ((to.db - from.db) / (to.t - from.t)) * NEPER_PER_DB;
  const intercept = from.db * NEPER_PER_DB - slope * from.t;
  return `exp(${decimal(intercept)}+t*${decimal(slope)})`;
}

/** Leaves low..high on `t`, leaf i ≥ 1 starting at knot i − 1's time. */
const tree = (knots: readonly Knot[], low: number, high: number): string =>
  balancedIf(
    {
      variable: 't',
      leaf: (index) => leaf(knots, index),
      start: (index) => {
        const knot = knots[index - 1];
        return knot ? decimal(knot.t) : null;
      },
    },
    low,
    high,
  );

function knotsOf(points: readonly GainPoint[], sampleRate: number): Knot[] {
  return [...points]
    .sort((a, b) => a.sample - b.sample)
    .map((point) => ({ t: point.sample / sampleRate, db: Math.min(0, point.db) }));
}

/**
 * The `volume` expression of `t` (render seconds) for an envelope, or null when it never moves off 0 dB.
 * At a point's own time the expression gives its gain exactly. Gains above 0 dB are cut (ducking never boosts).
 */
export function gainExpression(
  points: readonly GainPoint[],
  sampleRate: number = MIX_SAMPLE_RATE,
): string | null {
  const knots = knotsOf(points, sampleRate);
  if (knots.every((knot) => knot.db === 0)) return null;
  return tree(knots, 0, knots.length);
}

/** The linear gain the envelope means at `seconds`: what the expression must evaluate to (tests read it). */
export function gainAt(
  points: readonly GainPoint[],
  seconds: number,
  sampleRate: number = MIX_SAMPLE_RATE,
): number {
  const knots = knotsOf(points, sampleRate);
  const first = knots[0];
  if (!first || seconds < first.t) return Math.exp((first?.db ?? 0) * NEPER_PER_DB);
  let index = 0;
  while (index + 1 < knots.length && (knots[index + 1]?.t ?? Infinity) <= seconds) index++;
  const from = knots[index] ?? first;
  const to = knots[index + 1];
  if (!to || to.t <= from.t) return Math.exp(from.db * NEPER_PER_DB);
  return Math.exp((from.db + ((to.db - from.db) * (seconds - from.t)) / (to.t - from.t)) * NEPER_PER_DB);
}
