// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FIX-CAST: the beam fills slots left to right, so an early slot can take the clip a later one needs more (the hook
 * took the night clip the night slot wanted, and the outro was left a gap). After the search, each sequence takes
 * the best move while one raises its score: two slots swap their picks, a pick moves into a gap, or a slot takes an
 * unused candidate. The same rules as the beam hold: a shot once, locked slots kept, slot 0 never a gap or a banned
 * hook, the variant's extra costs paid. Deterministic: ties keep the earlier move.
 */
import type { Adjacency } from './alternates';
import { compareSequences, type Sequence } from './beam';
import type { Candidate, SlotPool } from './candidates';

export interface ImproveOptions {
  readonly adjacency: Adjacency;
  readonly tie: number;
  readonly extra?: (slot: number, key: string) => number;
  readonly bannedHooks?: ReadonlySet<string>;
}

type Picks = (Candidate | null)[];

/** The score of the picks at `slots` and of every neighbour pair touching them. */
function local(picks: Picks, slots: readonly number[], options: ImproveOptions): number {
  let score = 0;
  const edges = new Set<number>();
  for (const slot of slots) {
    const pick = picks[slot];
    if (pick) score += pick.unary - (options.extra ? options.extra(slot, pick.key) : 0);
    edges.add(slot);
    edges.add(slot + 1);
  }
  for (const edge of edges) {
    const previous = picks[edge - 1];
    const next = picks[edge];
    if (previous && next) score -= options.adjacency(previous, next);
  }
  return score;
}

interface Move {
  readonly slots: readonly number[];
  readonly with: readonly (Candidate | null)[];
  readonly gain: number;
}

function bestMove(
  picks: Picks,
  pools: readonly SlotPool[],
  byKey: readonly Map<string, Candidate>[],
  options: ImproveOptions,
) {
  let best: Move | null = null;
  const used = new Set(picks.flatMap((pick) => (pick ? [pick.key] : [])));
  const allowed = (slot: number, candidate: Candidate | null) =>
    slot !== 0 || (candidate !== null && !options.bannedHooks?.has(candidate.key));
  const consider = (slots: readonly number[], replacements: readonly (Candidate | null)[]) => {
    const before = local(picks, slots, options);
    const next = [...picks];
    slots.forEach((slot, index) => (next[slot] = replacements[index] ?? null));
    const gain = local(next, slots, options) - before;
    if (gain > options.tie && (!best || gain > best.gain + options.tie))
      best = { slots, with: replacements, gain };
  };
  for (let i = 0; i < pools.length; i++) {
    if (pools[i]?.locked) continue;
    for (let j = i + 1; j < pools.length; j++) {
      if (pools[j]?.locked) continue;
      const a = picks[i] ?? null;
      const b = picks[j] ?? null;
      if (!a && !b) continue;
      const bAtI = b ? (byKey[i]?.get(b.key) ?? null) : null;
      const aAtJ = a ? (byKey[j]?.get(a.key) ?? null) : null;
      if ((b && !bAtI) || (a && !aAtJ) || !allowed(i, bAtI)) continue;
      consider([i, j], [bAtI, aAtJ]);
    }
    for (const candidate of pools[i]?.candidates ?? [])
      if (!used.has(candidate.key) && allowed(i, candidate)) consider([i], [candidate]);
  }
  return best as Move | null;
}

export function improveSequence(
  sequence: Sequence,
  pools: readonly SlotPool[],
  options: ImproveOptions,
): Sequence {
  const byKey = pools.map((pool) => new Map(pool.candidates.map((candidate) => [candidate.key, candidate])));
  const picks: Picks = [...sequence.picks];
  let score = sequence.score;
  // Each move raises the score by more than the tie, so this ends; the bound only guards a broken adjacency.
  for (let pass = 0; pass < pools.length * pools.length; pass++) {
    const move = bestMove(picks, pools, byKey, options);
    if (!move) break;
    move.slots.forEach((slot, index) => (picks[slot] = move.with[index] ?? null));
    score += move.gain;
  }
  return { picks, score };
}

/** Every final state improved, best first, without repeats. */
export function improveAll(
  states: readonly Sequence[],
  pools: readonly SlotPool[],
  options: ImproveOptions,
): Sequence[] {
  const seen = new Set<string>();
  return states
    .map((state) => improveSequence(state, pools, options))
    .sort((a, b) => compareSequences(a, b, options.tie))
    .filter((state) => {
      const key = state.picks.map((pick) => pick?.key ?? '').join('|');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
