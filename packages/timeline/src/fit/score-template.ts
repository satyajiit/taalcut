// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * One template's fit from its slots' candidates (LRN1-TPL): distinct shots matched to slots, then coverage (the
 * share of slots filled above casting's floor), the mean casting score of the filled slots, the fit score (the mean
 * over every slot, a short slot scoring 0), the hook (slot 0's hook score) and the slots short, each with why. And the
 * ranking (SPEC, "LRN1-TPL", step 5): fit score, then coverage, then hook, then the template id, so the same input
 * always gives the same order.
 */
import type { FitWeakReason } from '@taalcut/core';
import type { CastingConfig } from '../casting/config';
import { matchSlots } from './matching';
import type { FitSlot } from './slot-candidates';

export interface WeakSlot {
  readonly index: number;
  readonly reason: FitWeakReason;
}

export interface TemplateScore {
  readonly slots: number;
  readonly covered: number;
  readonly coverage: number;
  readonly meanScore: number | null;
  /** The casting score summed over the filled slots, over every slot: meanScore × coverage. Null when none is filled. */
  readonly fitScore: number | null;
  readonly hook: number | null;
  readonly weak: readonly WeakSlot[];
}

function reasonOf(slot: FitSlot): FitWeakReason {
  if (slot.candidates.length > 0) return 'taken';
  return slot.relaxedOnly ? 'orientation' : 'noShot';
}

export function scoreTemplate(slots: readonly FitSlot[]): TemplateScore {
  const picked = matchSlots(slots);
  const filled = picked.filter((candidate) => candidate !== null);
  const weak = slots.flatMap((slot, index) =>
    picked[index] === null ? [{ index, reason: reasonOf(slot) }] : [],
  );
  const total = filled.reduce((sum, candidate) => sum + candidate.unary, 0);
  return {
    slots: slots.length,
    covered: filled.length,
    coverage: slots.length > 0 ? filled.length / slots.length : 0,
    meanScore: filled.length > 0 ? total / filled.length : null,
    fitScore: filled.length > 0 ? total / slots.length : null,
    hook: picked[0]?.parts.hook ?? null,
    weak,
  };
}

/** Scores within casting's tie epsilon are equal; null (nothing filled) ranks last. */
function compareScores(a: number | null, b: number | null, epsilon: number): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  return Math.abs(a - b) <= epsilon ? 0 : b - a;
}

/**
 * Best first: fit score (a template filled completely is ranked by its mean score; one a slot short loses that slot's
 * share), then coverage, hook, and the lower template id. A template the footage fills none of comes last.
 */
export function compareFits(
  a: { readonly score: TemplateScore; readonly templateId: string },
  b: { readonly score: TemplateScore; readonly templateId: string },
  config: CastingConfig,
): number {
  const epsilon = config.tieEpsilon;
  return (
    compareScores(a.score.fitScore, b.score.fitScore, epsilon) ||
    compareScores(a.score.coverage, b.score.coverage, epsilon) ||
    compareScores(a.score.hook, b.score.hook, epsilon) ||
    (a.templateId < b.templateId ? -1 : a.templateId > b.templateId ? 1 : 0)
  );
}
