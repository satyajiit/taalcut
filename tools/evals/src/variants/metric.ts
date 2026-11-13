// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { VariantLabel, VariantPrediction, VariantRow } from './schema';

/** Both pair-shares must be 1: every pair differs in the hook and in at least 30% of picks. */
export const VARIANT_BARS = { hookDifferShare: 1, pickDifferShare: 1 } as const;

export interface VariantCaseScore {
  readonly caseId: string;
  readonly variants: number;
  readonly pairs: number;
  readonly hookDifferShare: number;
  readonly pickDifferShare: number;
  /** Minimum over variants. Absent when the label has no acceptable set. */
  readonly pickAcceptance: number | undefined;
}

/** 3/10 changed passes; 2/10 fails. Integer compare, so 3/10 is not a float short of 0.3. */
export function picksDiffer(left: readonly string[], right: readonly string[]): boolean {
  const slots = Math.max(left.length, right.length);
  if (slots === 0) return false;
  let changed = 0;
  for (let index = 0; index < slots; index += 1) {
    if (left[index] !== right[index]) changed += 1;
  }
  return changed * 1000 >= slots * 300;
}

function acceptanceOf(
  row: VariantRow,
  acceptable: readonly (readonly string[])[] | undefined,
): number | undefined {
  if (acceptable === undefined || acceptable.length !== row.picks.length || row.picks.length === 0)
    return undefined;
  let hits = 0;
  for (let index = 0; index < row.picks.length; index += 1) {
    const allowed = acceptable[index];
    const pick = row.picks[index];
    if (allowed !== undefined && pick !== undefined && allowed.includes(pick)) hits += 1;
  }
  return hits / row.picks.length;
}

export function scoreVariantCase(label: VariantLabel, prediction: VariantPrediction): VariantCaseScore {
  const rows = prediction.variants;
  let pairs = 0;
  let hookDiffer = 0;
  let pickDiffer = 0;
  for (let left = 0; left < rows.length; left += 1) {
    for (let right = left + 1; right < rows.length; right += 1) {
      const a = rows[left];
      const b = rows[right];
      if (a === undefined || b === undefined) continue;
      pairs += 1;
      if (a.hook !== b.hook) hookDiffer += 1;
      if (picksDiffer(a.picks, b.picks)) pickDiffer += 1;
    }
  }
  const acceptances = rows.flatMap((row) => {
    const share = acceptanceOf(row, label.acceptable);
    return share === undefined ? [] : [share];
  });
  const pickAcceptance =
    label.acceptable === undefined || acceptances.length !== rows.length
      ? undefined
      : Math.min(...acceptances);
  return {
    caseId: label.caseId,
    variants: rows.length,
    pairs,
    hookDifferShare: pairs === 0 ? 0 : hookDiffer / pairs,
    pickDifferShare: pairs === 0 ? 0 : pickDiffer / pairs,
    pickAcceptance,
  };
}

export function variantGatePasses(
  rows: readonly VariantCaseScore[],
  labels: readonly VariantLabel[],
): boolean {
  if (rows.length === 0) return false;
  return rows.every((row, index) => {
    const label = labels[index];
    return (
      label !== undefined &&
      row.variants === label.count &&
      row.hookDifferShare === VARIANT_BARS.hookDifferShare &&
      row.pickDifferShare === VARIANT_BARS.pickDifferShare
    );
  });
}
