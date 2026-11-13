// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Verdicts (earshot `match.VERDICTS`): bands of the calibrated z, strong from 3.0, plausible from 2.5, weak from 2.0,
 * else no match. Upstream judges the z it reports, rounded to 2 decimals, so this does too. Hint categories (the
 * unvalidated genre, mood, instrument and voice terms) never get one. D23: a z within ±0.15 of a band's start is
 * `borderline`, so a quantised model's drift is flagged instead of flipping unseen; the verdict still comes from z.
 */
import {
  isHintCategory,
  LISTEN_BORDERLINE_Z,
  LISTEN_VERDICT_Z,
  type ListenVerdict,
  type SoundTagCategory,
} from '@taalcut/core';

const BANDS: readonly (readonly [number, ListenVerdict])[] = [
  [LISTEN_VERDICT_Z.strong, 'strong'],
  [LISTEN_VERDICT_Z.plausible, 'plausible'],
  [LISTEN_VERDICT_Z.weak, 'weak'],
];

/**
 * Python's round(x, digits): the float's exact binary value rounded to `digits` decimals (2.675 is 2.67499… so 2.67),
 * an exact tie to the even digit (0.125 → 0.12). `toFixed` rounds the exact value too, but ties away from zero.
 */
export function roundTo(value: number, digits: number): number {
  if (!Number.isFinite(value)) return value;
  const exact = Math.abs(value).toFixed(digits + 30);
  const cut = exact.indexOf('.') + digits + 1;
  if (/^50*$/.test(exact.slice(cut))) {
    const kept = exact.slice(0, cut);
    const last = Number(kept.at(-1) === '.' ? kept.at(-2) : kept.at(-1));
    const down = Number(kept);
    const rounded = last % 2 === 0 ? down : down + 10 ** -digits;
    return Math.sign(value) * Number(rounded.toFixed(digits));
  }
  return Number(value.toFixed(digits));
}

/** The band of a z as upstream reports it (rounded to 2 decimals first). */
export function verdictOf(z: number): ListenVerdict {
  const shown = roundTo(z, 2);
  for (const [threshold, verdict] of BANDS) if (shown >= threshold) return verdict;
  return 'no_match';
}

/** D23: within ±0.15 of any band's start. */
export function isBorderline(z: number): boolean {
  return BANDS.some(([threshold]) => Math.abs(z - threshold) <= LISTEN_BORDERLINE_Z);
}

/** A hint category's verdict is null; anything else gets its band. */
export function verdictFor(z: number, category: SoundTagCategory): ListenVerdict | null {
  return isHintCategory(category) ? null : verdictOf(z);
}

/** `vocab.zf`: z for text, floored to 0.1 so it never contradicts a band (2.96 reads +2.9, not +3.0). */
export function floorZ(z: number): number {
  return Math.floor(z * 10 + 1e-9) / 10;
}

/** `match.softmax`: exp(scale·(x − max)) normalised. */
export function softmax(values: readonly number[], scale: number): number[] {
  const max = Math.max(...values);
  const e = values.map((v) => Math.exp(scale * (v - max)));
  const sum = e.reduce((a, b) => a + b, 0);
  return e.map((v) => v / sum);
}
