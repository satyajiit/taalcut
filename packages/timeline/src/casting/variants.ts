// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Casting step 8: sequential beams. Variant k pays for (slot, shot) pairs
 * earlier variants used and must open on a different hook; it is kept only if
 * it differs from every kept variant in at least ⌈30% × slots⌉ shot ids. Up
 * to `retries` more beams with the penalty doubled, then forced swaps of the
 * lowest-margin slots to their best unused alternate. If the library still
 * can't, fewer variants come back.
 */
import { slotChoice, ranked, type Adjacency } from './alternates';
import { beamSearch, sequenceScore, type Sequence } from './beam';
import type { SlotPool } from './candidates';
import type { CastingConfig } from './config';
import { improveAll } from './improve';

export interface Variant {
  readonly sequence: Sequence;
  /** Best minus second-best distinct sequence in the final beam; null when the beam had one. */
  readonly runnerUp: number | null;
}

const keyAt = (sequence: Sequence, slot: number) => sequence.picks[slot]?.key ?? null;

export function minimumDifferences(slots: number, config: CastingConfig): number {
  return Math.ceil(config.variants.minDifference * slots - config.tieEpsilon);
}

/** The hook rule is waived when slot 0 is locked or empty: no variant can open differently. */
export function hookFixed(pools: readonly SlotPool[]): boolean {
  const first = pools[0];
  return !first || first.locked || first.candidates.length === 0;
}

export function differsEnough(
  a: Sequence,
  b: Sequence,
  pools: readonly SlotPool[],
  config: CastingConfig,
): boolean {
  if (!hookFixed(pools) && keyAt(a, 0) === keyAt(b, 0)) return false;
  let differences = 0;
  for (let slot = 0; slot < pools.length; slot++) if (keyAt(a, slot) !== keyAt(b, slot)) differences++;
  return differences >= minimumDifferences(pools.length, config);
}

function runnerUp(states: readonly Sequence[]): number | null {
  const [best, ...rest] = states;
  if (!best) return null;
  const second = rest.find((state) => state.picks.some((pick, slot) => pick?.key !== best.picks[slot]?.key));
  return second ? Math.max(0, best.score - second.score) : null;
}

/** What a forced swap searches: the slot pools, how neighbouring picks score, and the casting rules. */
export interface SwapContext {
  readonly pools: readonly SlotPool[];
  readonly adjacency: Adjacency;
  readonly config: CastingConfig;
}

/**
 * Swaps the lowest-margin slots (the hook first when it repeats; then, when given, the slots `prefer` ranks lower)
 * until the variant differs enough from every kept one.
 */
export function forceSwaps(
  start: Sequence,
  kept: readonly Sequence[],
  context: SwapContext,
  prefer: (slot: number) => number = () => 0,
): Sequence | null {
  const { pools, adjacency, config } = context;
  const picks = [...start.picks];
  const probe: Sequence = { picks, score: 0 };
  const hooks = new Set(kept.map((sequence) => keyAt(sequence, 0)));
  const hookRepeats = !hookFixed(pools) && hooks.has(keyAt(start, 0));
  const first = (slot: number) => (hookRepeats && slot === 0 ? 0 : 1);
  const order = pools
    .map((pool, slot) => ({ slot, pool }))
    .filter(({ pool, slot }) => !pool.locked && picks[slot] !== null)
    .map(({ slot }) => {
      const choice = slotChoice(pools, start, slot, adjacency, config);
      const second = choice.alternates[0];
      return { slot, margin: choice.pick && second ? choice.pick.score - second.score : Infinity };
    })
    .sort(
      (a, b) =>
        first(a.slot) - first(b.slot) ||
        prefer(a.slot) - prefer(b.slot) ||
        a.margin - b.margin ||
        a.slot - b.slot,
    );
  for (const { slot } of order) {
    if (kept.every((sequence) => differsEnough(probe, sequence, pools, config))) break;
    const taken = new Set(kept.map((sequence) => keyAt(sequence, slot)));
    const options = ranked(pools, picks, slot, adjacency, config.tieEpsilon).filter(
      (entry) => entry.candidate.key !== picks[slot]?.key && !taken.has(entry.candidate.key),
    );
    const swap = options.find((entry) => slot !== 0 || !hooks.has(entry.candidate.key));
    if (swap) picks[slot] = swap.candidate;
  }
  return kept.every((sequence) => differsEnough(probe, sequence, pools, config))
    ? { picks, score: sequenceScore(picks, adjacency) }
    : null;
}

/** One search for a variant: the final states, best first. Template mode is the beam; story mode its own. */
export type VariantSearch = (constraints: {
  readonly extra?: (slot: number, key: string) => number;
  readonly bannedHooks?: ReadonlySet<string>;
}) => Sequence[];

export function castVariants(
  pools: readonly SlotPool[],
  count: number,
  adjacency: Adjacency,
  config: CastingConfig,
  search?: VariantSearch,
  /** FIX-STORY: where the first variant also starts from, beside the search (a reranked cast's, swaps.ts). */
  seed?: Sequence,
): Variant[] {
  const kept: Variant[] = [];
  const options = { width: config.beam.width, tie: config.tieEpsilon, adjacency };
  // FIX-CAST: the beam's final states are improved by swaps, so each clip goes where it fits best (improve.ts).
  const run: VariantSearch =
    search ??
    ((constraints) =>
      improveAll(beamSearch(pools, { ...options, ...constraints }), pools, { ...options, ...constraints }));
  for (let index = 0; index < count; index++) {
    if (index === 0) {
      const searched = run({});
      const states = seed ? improveAll([...searched, seed], pools, options) : searched;
      const best = states[0];
      if (!best) break;
      kept.push({ sequence: best, runnerUp: runnerUp(states) });
      continue;
    }
    const sequences = kept.map((variant) => variant.sequence);
    const uses = new Map<string, number>();
    for (const sequence of sequences)
      sequence.picks.forEach((pick, slot) => {
        if (pick) uses.set(`${slot}:${pick.key}`, (uses.get(`${slot}:${pick.key}`) ?? 0) + 1);
      });
    const bannedHooks = hookFixed(pools)
      ? new Set<string>()
      : new Set(sequences.flatMap((sequence) => (sequence.picks[0] ? [sequence.picks[0].key] : [])));
    let penalty = config.variants.reusePenalty;
    let accepted: Variant | null = null;
    let last: Sequence | null = null;
    for (let attempt = 0; attempt <= config.variants.retries && !accepted; attempt++) {
      const extra = (slot: number, key: string) => penalty * (uses.get(`${slot}:${key}`) ?? 0);
      const states = run({ extra, bannedHooks });
      const best = states[0];
      if (!best) break;
      const plain = { picks: best.picks, score: sequenceScore(best.picks, adjacency) };
      last = plain;
      if (sequences.every((sequence) => differsEnough(plain, sequence, pools, config)))
        accepted = { sequence: plain, runnerUp: runnerUp(states) };
      penalty *= 2;
    }
    if (!accepted && last) {
      const forced = forceSwaps(last, sequences, { pools, adjacency, config });
      if (forced) accepted = { sequence: forced, runnerUp: null };
    }
    if (!accepted) break;
    kept.push(accepted);
  }
  return kept;
}
