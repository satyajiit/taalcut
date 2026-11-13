// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Hook variants of an existing cut (P3-V3): the base video's picks are the first "earlier variant", and each new
 * variant starts from them and changes only what the variant rule needs (casting step 8's forced swaps): a hook
 * shot no earlier variant opened on, then the other hook-window slots, then the lowest-margin slots, until it
 * differs from the base and every earlier variant in at least ⌈30% × slots⌉ picks. Locked slots keep their shot.
 */
import { ok, type AssetId, type AsyncResult, type ShotId, type SlotId, type Template } from '@taalcut/core';
import { candidateKey } from '../model/cast';
import type { Adjacency } from './alternates';
import { sequenceScore, type Sequence } from './beam';
import { scoreCandidate, type Candidate, type CandidateContext, type SlotPool } from './candidates';
import { buildVariant, type CastVariant } from './result';
import { slotSpecs } from './slots';
import { lockedShots, templatePools, type LockedShot } from './template-pools';
import { forceSwaps } from './variants';

export interface HookVariantRequest {
  readonly template: Template;
  /** The base video's shot in each slot it fills (a gap has none). */
  readonly base: readonly {
    readonly slotId: SlotId;
    readonly assetId: AssetId;
    readonly shotId: ShotId | null;
  }[];
  readonly locked?: readonly LockedShot[];
  /** Slots that start inside the hook window (the first is slot 0): changed right after the hook shot. */
  readonly hookSlotIds: readonly SlotId[];
  readonly count: number;
  /** The base video's canvas, whose orientation the new picks match (BRK1-MAKE). Default: the template's. */
  readonly canvas?: { readonly width: number; readonly height: number };
}

/** The base's picks as pool candidates; a base shot outside its slot's pool joins the pool. */
async function withBase(
  pools: readonly SlotPool[],
  request: HookVariantRequest,
  context: CandidateContext,
): AsyncResult<{ pools: SlotPool[]; base: Sequence }> {
  const bySlot = new Map(request.base.map((entry) => [entry.slotId as string, entry]));
  const missing = pools.flatMap((pool) => {
    const entry = bySlot.get(pool.slot.slotId);
    if (!entry || pool.locked) return [];
    return pool.candidates.some((candidate) => candidate.key === candidateKey(entry)) ? [] : [entry];
  });
  const found = missing.length > 0 ? await context.catalog.profiles(missing, context.signal) : ok([]);
  if (!found.ok) return found;
  const profiles = new Map(found.value.map((profile) => [candidateKey(profile), profile]));
  const out = pools.map((pool) => {
    const entry = bySlot.get(pool.slot.slotId);
    const profile = entry ? profiles.get(candidateKey(entry)) : undefined;
    if (!profile || pool.locked) return pool;
    return { ...pool, candidates: [...pool.candidates, scoreCandidate(pool.slot, profile, null, context)] };
  });
  const picks = out.map((pool): Candidate | null => {
    if (pool.locked) return pool.candidates[0] ?? null;
    const entry = bySlot.get(pool.slot.slotId);
    return entry
      ? (pool.candidates.find((candidate) => candidate.key === candidateKey(entry)) ?? null)
      : null;
  });
  return ok({ pools: out, base: { picks, score: 0 } });
}

export async function castHookVariants(
  request: HookVariantRequest,
  context: CandidateContext,
  adjacency: Adjacency,
): AsyncResult<CastVariant[]> {
  const { config } = context;
  const specs = slotSpecs(
    request.template,
    config,
    request.canvas ? { ...request.template.canvas, ...request.canvas } : undefined,
  );
  const locked = await lockedShots(request.locked ?? [], specs, context);
  if (!locked.ok) return locked;
  const excluded = new Set([...locked.value.profiles.values()].map((profile) => candidateKey(profile)));
  const gathered = await templatePools(
    { specs, locked: locked.value.profiles, scope: {}, excluded },
    context,
  );
  if (!gathered.ok) return gathered;
  const seeded = await withBase(gathered.value, request, context);
  if (!seeded.ok) return seeded;
  const { pools } = seeded.value;
  const base: Sequence = {
    picks: seeded.value.base.picks,
    score: sequenceScore(seeded.value.base.picks, adjacency),
  };
  const hook = new Set<string>(request.hookSlotIds);
  const prefer = (slot: number) => (slot === 0 || hook.has(pools[slot]?.slot.slotId ?? '') ? 0 : 1);
  const kept: Sequence[] = [base];
  const out: CastVariant[] = [];
  for (let index = 0; index < request.count; index++) {
    const forced = forceSwaps(base, kept, { pools, adjacency, config }, prefer);
    if (!forced) break;
    kept.push(forced);
    out.push(
      buildVariant({ sequence: forced, runnerUp: null }, pools, locked.value.picks, {
        adjacency,
        config,
        canvasRate: request.template.canvas.rate,
      }),
    );
  }
  return ok(out);
}
