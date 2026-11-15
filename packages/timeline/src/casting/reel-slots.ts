// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * KEEP1: slots that keep the reel's own footage (core's slot-footage.ts), in casting. The template states which
 * they are; casting acts on the statement and decides nothing about what a shot shows. Such a slot takes nothing
 * from the library: its pool is empty and never gathered, a lock or a rerank on it is dropped (it would only take
 * the shot away from the person's slots), story order leaves it out, and its note is `reelKept`, not `noCandidates`.
 * Assembly fills it from the template's kept reel (assembly/reel-footage.ts).
 */
import { keepsReelFootage, type SlotId, type Template } from '@taalcut/core';
import type { SlotPool } from './candidates';
import type { SlotSpec } from './slots';
import type { VariantSearch } from './variants';

/** The pool of a slot that keeps the reel's footage: nothing to choose from, and nothing asked of the library. */
export const reelPool = (slot: SlotSpec): SlotPool => ({
  slot,
  candidates: [],
  locked: false,
  relaxed: false,
  reranked: false,
});

/** Whether any slot of the template keeps the reel's own footage. */
export const hasReelSlots = (template: Pick<Template, 'slots'>): boolean =>
  template.slots.some(keepsReelFootage);

/** What the request names per slot (locks, reranks, parts), without the slots that keep the reel's footage. */
export function forPersonSlots<T extends { readonly slotId: SlotId }>(
  named: readonly T[],
  specs: readonly SlotSpec[],
): T[] {
  const reel = new Set(specs.flatMap((spec) => (spec.reel ? [spec.slotId as string] : [])));
  return reel.size === 0 ? [...named] : named.filter((entry) => !reel.has(entry.slotId));
}

/**
 * The request without the reranks that name a reel slot: there is nothing to reorder there, and a rerank that puts
 * another slot's pick first would swap the person's clip into the reel's footage (swaps.ts).
 */
export function personRerank<
  T extends { readonly template: Pick<Template, 'slots'>; readonly rerank?: readonly { slotId: SlotId }[] },
>(request: T): T {
  if (!request.rerank || !hasReelSlots(request.template)) return request;
  const reel = new Set(request.template.slots.filter(keepsReelFootage).map((slot) => slot.id as string));
  return { ...request, rerank: request.rerank.filter((entry) => !reel.has(entry.slotId)) };
}

/**
 * The pools and the search with every reel slot empty, in either mode: template pools never gathered one, and story
 * order's plan, which fills blocks by capture time, has its pick there taken out.
 */
export function withoutReelPicks(
  pools: readonly SlotPool[],
  search: VariantSearch | undefined,
): { pools: SlotPool[]; search: VariantSearch | undefined } {
  const reel = new Set(pools.flatMap((pool, index) => (pool.slot.reel ? [index] : [])));
  if (reel.size === 0) return { pools: [...pools], search };
  return {
    pools: pools.map((pool, index) => (reel.has(index) ? reelPool(pool.slot) : pool)),
    search:
      search &&
      ((constraints) =>
        search(constraints).map((sequence) => ({
          ...sequence,
          picks: sequence.picks.map((pick, slot) => (reel.has(slot) ? null : pick)),
        }))),
  };
}
