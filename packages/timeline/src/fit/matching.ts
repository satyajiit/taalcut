// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Which distinct shots fill which slots (LRN1-TPL fit): a shot fills at most one slot, as in a cast. First greedy by
 * casting's score (best pair first; ties to the earlier slot, then the lower shot key), then augmenting paths
 * (Kuhn's algorithm) for every slot left empty, each trying its candidates best first. Augmenting only moves shots
 * between slots that keep one, so the result fills as many slots as any assignment can, mostly with the greedy
 * pairs. Deterministic: the same slots and candidates give the same assignment.
 */
import type { Candidate } from '../casting/candidates';

export interface MatchSlot {
  /** Best score first. */
  readonly candidates: readonly Candidate[];
}

/** Per slot, the candidate it got, or null. */
export function matchSlots(slots: readonly MatchSlot[]): (Candidate | null)[] {
  const picked: (Candidate | null)[] = slots.map(() => null);
  const owner = new Map<string, number>();

  const edges = slots
    .flatMap((slot, index) => slot.candidates.map((candidate) => ({ index, candidate })))
    .sort(
      (a, b) =>
        b.candidate.unary - a.candidate.unary ||
        a.index - b.index ||
        (a.candidate.key < b.candidate.key ? -1 : 1),
    );
  for (const { index, candidate } of edges) {
    if (picked[index] !== null || owner.has(candidate.key)) continue;
    picked[index] = candidate;
    owner.set(candidate.key, index);
  }

  const augment = (index: number, seen: Set<string>): boolean => {
    for (const candidate of (slots[index] as MatchSlot).candidates) {
      if (seen.has(candidate.key)) continue;
      seen.add(candidate.key);
      const holder = owner.get(candidate.key);
      if (holder === undefined || augment(holder, seen)) {
        picked[index] = candidate;
        owner.set(candidate.key, index);
        return true;
      }
    }
    return false;
  };
  slots.forEach((_, index) => {
    if (picked[index] === null) augment(index, new Set());
  });
  return picked;
}
