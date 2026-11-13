// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Casting step 1 for one slot over an in-memory pool (LRN1-TPL fit): the same filter (`filterFor`: the canvas's
 * orientation, the media the slot consumes, casting's quality floor), the same top k by cosine with ties to the lower
 * shot key, the same "whole window fits" check after it, and each candidate scored by casting's own `scoreCandidate`.
 * A slot that says nothing takes the pool's best quality first, as casting does. Only the search differs: here the
 * cosines come from the pool's packed vectors instead of the library's index.
 */
import type { ShotProfile, ShotProfileFilter } from '@taalcut/core';
import { fitsSlot, filterFor, scoreCandidate, type Candidate } from '../casting/candidates';
import { matchesFilter, profileKey } from '../casting/catalog';
import type { CastingConfig } from '../casting/config';
import type { SlotSpec } from '../casting/slots';

export interface FitSlot {
  readonly spec: SlotSpec;
  /** What casting's first (strict) pass would gather, best unary score first. */
  readonly candidates: readonly Candidate[];
  /** With no strict candidate: whether the relaxed pass (other orientations) would find one. */
  readonly relaxedOnly: boolean;
}

export interface ShotPool {
  /** Every shot with a vector, oldest capture first (the order the profile source lists them). */
  readonly profiles: readonly ShotProfile[];
  readonly keys: readonly string[];
}

export interface ScoreContext {
  readonly config: CastingConfig;
  /** The newest library shots' vectors: the hook's novelty, as casting reads them. */
  readonly recent: readonly Float32Array[];
  /** One fit's pool rows per distinct filter: slots asking the same of a shot share one pass over the pool. */
  readonly passing: Map<string, readonly number[]>;
}

const NO_EXCLUSIONS: ReadonlySet<string> = new Set();

/**
 * What a filter asks of a shot, as a key. Fit's filters never exclude shots or bound capture time (the pool does),
 * so the orientation, the length the slot consumes and the quality floor are all that tell two apart.
 */
function filterKey(filter: ShotProfileFilter): string {
  const length = filter.minDuration;
  return JSON.stringify([
    filter.orientations ?? null,
    length ? [length.value, length.rate.num, length.rate.den] : null,
    filter.minQuality ?? null,
  ]);
}

/** Pool rows passing the slot's filter (strict or relaxed), as casting's catalogue would filter them. */
function passing(spec: SlotSpec, pool: ShotPool, context: ScoreContext, relaxed: boolean): readonly number[] {
  const filter = filterFor(spec, {}, NO_EXCLUSIONS, context.config, relaxed);
  const key = filterKey(filter);
  const known = context.passing.get(key);
  if (known) return known;
  const rows: number[] = [];
  pool.profiles.forEach((profile, row) => {
    if (matchesFilter(profile, filter)) rows.push(row);
  });
  context.passing.set(key, rows);
  return rows;
}

/** The top k rows by cosine (ties to the lower key), then only shots long enough for the whole window. */
function nearest(
  spec: SlotSpec,
  rows: readonly number[],
  cosines: Float64Array,
  pool: ShotPool,
  k: number,
): number[] {
  const key = (row: number) => pool.keys[row] as string;
  return [...rows]
    .sort((a, b) => (cosines[b] as number) - (cosines[a] as number) || (key(a) < key(b) ? -1 : 1))
    .slice(0, k)
    .filter((row) => fitsSlot(pool.profiles[row] as ShotProfile, spec));
}

/** With no intent: the oldest `storyPoolLimit` that pass, long enough, best quality first (ties to the lower key). */
function bestQuality(
  spec: SlotSpec,
  rows: readonly number[],
  pool: ShotPool,
  config: CastingConfig,
): number[] {
  const profile = (row: number) => pool.profiles[row] as ShotProfile;
  return rows
    .slice(0, config.candidates.storyPoolLimit)
    .filter((row) => fitsSlot(profile(row), spec))
    .sort(
      (a, b) =>
        profile(b).quality - profile(a).quality || (profileKey(profile(a)) < profileKey(profile(b)) ? -1 : 1),
    )
    .slice(0, config.candidates.k);
}

function gather(
  spec: SlotSpec,
  cosines: Float64Array | null,
  pool: ShotPool,
  context: ScoreContext,
  relaxed: boolean,
) {
  const rows = passing(spec, pool, context, relaxed);
  const { config } = context;
  return cosines
    ? nearest(spec, rows, cosines, pool, config.candidates.k)
    : bestQuality(spec, rows, pool, config);
}

/** One slot's candidates as casting's step 1 would gather and score them from this pool. */
export function slotCandidates(
  spec: SlotSpec,
  cosines: Float64Array | null,
  pool: ShotPool,
  context: ScoreContext,
): FitSlot {
  const strict = gather(spec, cosines, pool, context, false);
  const candidates = strict
    .map((row) =>
      scoreCandidate(
        spec,
        pool.profiles[row] as ShotProfile,
        cosines ? (cosines[row] as number) : null,
        context,
      ),
    )
    .sort((a, b) => b.unary - a.unary || (a.key < b.key ? -1 : 1));
  const relaxedOnly = candidates.length === 0 && gather(spec, cosines, pool, context, true).length > 0;
  return { spec, candidates, relaxedOnly };
}
