// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Casting step 4: beam search left to right in slot order, ranked by score so
 * far (unary minus neighbour penalties); a shot is used once per variant; ties
 * go to the lower shot-id sequence. Deterministic for one library state.
 */
import type { Candidate, SlotPool } from './candidates';

export interface Sequence {
  /** One per slot; null is a gap. */
  readonly picks: readonly (Candidate | null)[];
  readonly score: number;
}

export interface BeamOptions {
  readonly width: number;
  readonly tie: number;
  readonly adjacency: (previous: Candidate, next: Candidate) => number;
  /** Extra cost of `key` in slot `slot` (variants: pairs earlier variants used). */
  readonly extra?: (slot: number, key: string) => number;
  /** Keys slot 0 may not open on (earlier variants' hooks). */
  readonly bannedHooks?: ReadonlySet<string>;
}

interface State {
  readonly picks: (Candidate | null)[];
  readonly score: number;
}

/** Compares key sequences: the lower shot ids first. */
function compareKeys(a: readonly (Candidate | null)[], b: readonly (Candidate | null)[]): number {
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index++) {
    const x = a[index]?.key ?? '';
    const y = b[index]?.key ?? '';
    if (x !== y) return x < y ? -1 : 1;
  }
  return a.length - b.length;
}

export function compareSequences(a: Sequence, b: Sequence, tie: number): number {
  if (Math.abs(a.score - b.score) > tie) return b.score - a.score;
  return compareKeys(a.picks, b.picks);
}

function lastPick(picks: readonly (Candidate | null)[]): Candidate | null {
  return picks.length === 0 ? null : (picks[picks.length - 1] ?? null);
}

/** The final beam, best first; empty when a constraint leaves some slot with no option. */
export function beamSearch(pools: readonly SlotPool[], options: BeamOptions): Sequence[] {
  let states: State[] = [{ picks: [], score: 0 }];
  pools.forEach((pool, slot) => {
    if (pool.candidates.length === 0) {
      states = states.map((state) => ({ picks: [...state.picks, null], score: state.score }));
      return;
    }
    const next: { parent: State; candidate: Candidate | null; score: number }[] = [];
    for (const parent of states) {
      const used = new Set(parent.picks.flatMap((pick) => (pick ? [pick.key] : [])));
      const previous = lastPick(parent.picks);
      let extended = false;
      for (const candidate of pool.candidates) {
        if (used.has(candidate.key)) continue;
        if (slot === 0 && options.bannedHooks?.has(candidate.key)) continue;
        const penalty = previous ? options.adjacency(previous, candidate) : 0;
        const extra = options.extra ? options.extra(slot, candidate.key) : 0;
        next.push({ parent, candidate, score: parent.score + candidate.unary - penalty - extra });
        extended = true;
      }
      // Every candidate is used earlier in this sequence: the slot stays a gap (a shot is never reused).
      // Slot 0 never opens on a gap: a variant that can't find a new hook fails instead.
      if (!extended && slot > 0) next.push({ parent, candidate: null, score: parent.score });
    }
    next.sort((a, b) => {
      if (Math.abs(a.score - b.score) > options.tie) return b.score - a.score;
      return compareKeys(a.parent.picks, b.parent.picks) || ((a.candidate?.key ?? '') < (b.candidate?.key ?? '') ? -1 : 1);
    });
    states = next
      .slice(0, options.width)
      .map(({ parent, candidate, score }) => ({ picks: [...parent.picks, candidate], score }));
  });
  if (states.some((state) => state.picks.length !== pools.length)) return [];
  return states;
}

/** Score of a sequence without variant penalties: unary minus neighbour penalties. */
export function sequenceScore(
  picks: readonly (Candidate | null)[],
  adjacency: (previous: Candidate, next: Candidate) => number,
): number {
  let score = 0;
  picks.forEach((pick, index) => {
    if (!pick) return;
    score += pick.unary;
    const previous = index > 0 ? picks[index - 1] : null;
    if (previous) score -= adjacency(previous, pick);
  });
  return score;
}
