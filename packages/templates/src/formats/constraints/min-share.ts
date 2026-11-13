// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { AllocatedPart, AllocationConstraint } from './types';

/**
 * `key` keeps at least `share` of the beat budget. Beats come back from later
 * non-hook sections (shorten, then drop slots). Earlier sections stay put.
 */
export function minShare(key: string, share: number): AllocationConstraint {
  return {
    name: `minShare(${key},${share})`,
    enforce(parts, units) {
      const index = parts.findIndex((part) => part.section.key === key);
      const part = parts[index];
      if (!part || !(share > 0) || units <= 0) return false;
      const need = Math.ceil(share * units - 1e-6);
      const later = parts.slice(index + 1).filter((candidate) => candidate.section.role !== 'hook');
      let guard = 0;
      while (sum(part.lengths) < need) {
        if (guard++ > units + 2) return false;
        const freed = takeFromLater(later);
        if (freed <= 0) return false;
        addBeats(part, freed);
      }
      return true;
    },
  };
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function takeFromLater(later: readonly AllocatedPart[]): number {
  for (let index = later.length - 1; index >= 0; index--) {
    const part = later[index];
    if (!part) continue;
    for (let slot = part.lengths.length - 1; slot >= 0; slot--) {
      const length = part.lengths[slot];
      if (length !== undefined && length > part.range.min) {
        part.lengths[slot] = length - 1;
        return 1;
      }
    }
  }
  for (let index = later.length - 1; index >= 0; index--) {
    const part = later[index];
    if (!part || part.section.fill) continue;
    const floor = part.section.optional ? part.section.count.min : Math.max(1, part.section.count.min);
    if (part.lengths.length > floor) return part.lengths.pop() ?? 0;
  }
  return 0;
}

/** Place `beats` onto `part`, keeping slots inside the range when the total allows it. */
function addBeats(part: AllocatedPart, beats: number): void {
  const total = sum(part.lengths) + beats;
  const { min, pref, max } = part.range;
  if (total <= 0) {
    part.lengths = [];
    return;
  }
  if (total < min) {
    part.lengths = [total];
    return;
  }
  let count = Math.max(1, Math.round(total / Math.max(1, pref)));
  while (count > 1 && Math.floor(total / count) < min) count -= 1;
  while (count < total && Math.ceil(total / count) > max) count += 1;
  const base = Math.floor(total / count);
  if (base > max) {
    const slots = Math.max(1, Math.floor(total / max));
    const lengths = Array.from({ length: slots }, () => max);
    const rem = total - slots * max;
    const last = lengths[lengths.length - 1];
    if (rem > 0 && last !== undefined) lengths[lengths.length - 1] = last + rem;
    part.lengths = lengths;
    return;
  }
  const extra = total - base * count;
  part.lengths = Array.from({ length: count }, (_, index) => base + (index < extra ? 1 : 0));
}
