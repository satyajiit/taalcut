// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { type EvalShot } from '../adapters/types';
import { shotsMatch } from '../shot-match';
import { type CastingCase, type CastingOrder, type CastingPrediction } from './schema';

/** Gate criterion 2. */
export const CAST_ACCEPT_BAR = 0.6;
/** A diverse pair differs in at least this share of picks, and in the hook. */
export const CAST_DIVERSITY_SHARE = 0.3;

export interface ShotTypeScore {
  shotType: string;
  slots: number;
  accepted: number;
  acceptance: number;
}

export interface CastingScores {
  /** Acceptable variant-1 picks ÷ slots. Slots never swapped. */
  pickAcceptance: number;
  /** Variant-1 sequences that satisfy every rule ÷ cases. Sequences never reordered. */
  orderAcceptance: number;
  alternatesAcceptance: number;
  /** Share of variant pairs that differ in ≥ 30% of picks and in the hook. */
  variantDiversity: number;
  slots: number;
  cases: number;
  shotTypes: ShotTypeScore[];
}

interface Pick {
  slotIndex: number;
  asset: string;
  range?: EvalShot['range'];
}

function asShot(pick: Pick): EvalShot {
  return pick.range === undefined ? { asset: pick.asset } : { asset: pick.asset, range: pick.range };
}

function acceptable(pick: Pick | undefined, shots: readonly EvalShot[]): boolean {
  if (pick === undefined) return false;
  return shots.some((shot) => shotsMatch(shot, asShot(pick)));
}

function orderKept(picks: readonly Pick[], order: CastingOrder | null): boolean {
  if (order === null || order.rules.length === 0) return true;
  const ordered = [...picks].sort((a, b) => a.slotIndex - b.slotIndex);
  for (const rule of order.rules) {
    const before = order.groups[rule.before];
    const after = order.groups[rule.after];
    if (before === undefined || after === undefined) return false;
    const beforeAt = ordered.findIndex((pick) => before.some((shot) => shotsMatch(shot, asShot(pick))));
    const afterAt = ordered.findIndex((pick) => after.some((shot) => shotsMatch(shot, asShot(pick))));
    if (beforeAt < 0 || afterAt < 0 || beforeAt >= afterAt) return false;
  }
  return true;
}

function pairDiverse(item: CastingCase, left: { picks: readonly Pick[] }, right: { picks: readonly Pick[] }): boolean {
  if (item.slots.length === 0) return false;
  let differ = 0;
  for (const slot of item.slots) {
    const a = left.picks.find((pick) => pick.slotIndex === slot.slotIndex);
    const b = right.picks.find((pick) => pick.slotIndex === slot.slotIndex);
    const same = a !== undefined && b !== undefined && shotsMatch(asShot(a), asShot(b));
    if (!same) differ += 1;
  }
  const hookA = left.picks.find((pick) => pick.slotIndex === 0);
  const hookB = right.picks.find((pick) => pick.slotIndex === 0);
  const hookDiffers = hookA === undefined || hookB === undefined || !shotsMatch(asShot(hookA), asShot(hookB));
  return differ / item.slots.length >= CAST_DIVERSITY_SHARE && hookDiffers;
}

export function scoreCastingCases(
  cases: readonly CastingCase[],
  predictions: ReadonlyMap<string, CastingPrediction>,
): CastingScores {
  if (cases.length === 0) throw new Error('No casting cases to score');
  let slots = 0;
  let accepted = 0;
  let kept = 0;
  let alternates = 0;
  let alternatesOk = 0;
  let pairs = 0;
  let diversePairs = 0;
  const byType = new Map<string, { slots: number; accepted: number }>();
  for (const item of cases) {
    const prediction = predictions.get(item.caseId);
    if (prediction === undefined) throw new Error(`No prediction for ${item.caseId}`);
    const variant = prediction.variants[0];
    if (variant === undefined) throw new Error(`No variant 1 for ${item.caseId}`);
    for (const slot of item.slots) {
      slots += 1;
      const pick = variant.picks.find((candidate) => candidate.slotIndex === slot.slotIndex);
      const ok = acceptable(pick, slot.acceptable);
      if (ok) accepted += 1;
      const shotType = slot.shotType ?? 'unspecified';
      const bucket = byType.get(shotType) ?? { slots: 0, accepted: 0 };
      bucket.slots += 1;
      if (ok) bucket.accepted += 1;
      byType.set(shotType, bucket);
    }
    if (orderKept(variant.picks, item.order)) kept += 1;
    for (const alternate of variant.alternates) {
      const slot = item.slots.find((candidate) => candidate.slotIndex === alternate.slotIndex);
      for (const shot of alternate.shots) {
        alternates += 1;
        if (slot !== undefined && slot.acceptable.some((label) => shotsMatch(label, shot))) alternatesOk += 1;
      }
    }
    for (let left = 0; left < prediction.variants.length; left += 1) {
      for (let right = left + 1; right < prediction.variants.length; right += 1) {
        const a = prediction.variants[left];
        const b = prediction.variants[right];
        if (a === undefined || b === undefined) continue;
        pairs += 1;
        if (pairDiverse(item, a, b)) diversePairs += 1;
      }
    }
  }
  return {
    pickAcceptance: accepted / slots,
    orderAcceptance: kept / cases.length,
    alternatesAcceptance: alternates === 0 ? 1 : alternatesOk / alternates,
    variantDiversity: pairs === 0 ? 0 : diversePairs / pairs,
    slots,
    cases: cases.length,
    shotTypes: [...byType.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([shotType, bucket]) => ({
        shotType,
        slots: bucket.slots,
        accepted: bucket.accepted,
        acceptance: bucket.accepted / bucket.slots,
      })),
  };
}

export function castingGatePasses(scores: CastingScores): boolean {
  return scores.pickAcceptance >= CAST_ACCEPT_BAR && scores.orderAcceptance >= CAST_ACCEPT_BAR;
}
