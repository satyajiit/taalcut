// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Template-mode pools (casting steps 1–3) and the user's locked shots, shared by `cast` and `hookVariants`: each
 * slot's intent embedded once, its pool gathered from the library, a locked slot's pool its one shot, then
 * every candidate scored with the distinctive words its slot asks for (FIX-STORY, terms.ts).
 */
import {
  ok,
  type AssetId,
  type AsyncResult,
  type RationalTime,
  type ShotId,
  type ShotProfile,
  type SlotId,
} from '@taalcut/core';
import { withNeedVectors } from './needs';
import {
  embedAll,
  gatherPool,
  withTerms,
  type CandidateContext,
  type PoolScope,
  type SlotPool,
} from './candidates';
import { profileKey } from './catalog';
import type { LockedPick } from './result';
import type { SlotSpec } from './slots';

/** A shot the user locked to a slot, with the in-point they chose (CastRequest.locked). */
export interface LockedShot {
  readonly slotId: SlotId;
  readonly assetId: AssetId;
  readonly shotId: ShotId | null;
  readonly sourceStart: RationalTime;
}

export interface LockedShots {
  readonly profiles: Map<number, ShotProfile>;
  readonly picks: Map<number, LockedPick>;
}

/** The shots the user locked, by slot index; a lock whose slot or shot is gone is dropped. */
export async function lockedShots(
  wanted: readonly LockedShot[],
  specs: readonly SlotSpec[],
  context: CandidateContext,
): AsyncResult<LockedShots> {
  const found = await context.catalog.profiles(wanted, context.signal);
  if (!found.ok) return found;
  const byKey = new Map(found.value.map((profile) => [profileKey(profile), profile]));
  const profiles = new Map<number, ShotProfile>();
  const picks = new Map<number, LockedPick>();
  const indexBySlotId = new Map(specs.map((spec, index) => [spec.slotId, index]));
  for (const lock of wanted) {
    const index = indexBySlotId.get(lock.slotId) ?? -1;
    const profile = byKey.get(lock.shotId ?? `asset:${lock.assetId}`);
    if (index < 0 || !profile) continue;
    profiles.set(index, profile);
    picks.set(index, { sourceStart: lock.sourceStart });
  }
  return ok({ profiles, picks });
}

export interface TemplatePoolInput {
  readonly specs: readonly SlotSpec[];
  readonly locked: ReadonlyMap<number, ShotProfile>;
  readonly rerank?: readonly { readonly slotId: SlotId; readonly order: readonly string[] }[];
  readonly scope: PoolScope;
  readonly excluded: ReadonlySet<string>;
  /** FIX-STORY: shots kept for one slot by a swap (swaps.ts): every other slot's pool leaves them out. */
  readonly reserved?: ReadonlyMap<string, string>;
}

export async function templatePools(
  input: TemplatePoolInput,
  context: CandidateContext,
): AsyncResult<SlotPool[]> {
  // FIX-HOOK: each slot's needs embedded beside its intent (needs.ts); fall back to lexical matching when unavailable.
  const isEmbedderUnavailable = (code: string) =>
    code === 'vision.embedder_unavailable' || code === 'library.embedder_unavailable';
  const needed = await withNeedVectors(input.specs, context.embedder, context.signal);
  if (!needed.ok && !isEmbedderUnavailable(needed.error.code)) return needed;
  const specs = needed.ok ? needed.value : input.specs;
  const texts = [...new Set(specs.flatMap((spec) => (spec.intentText ? [spec.intentText] : [])))];
  const vectors = needed.ok ? await embedAll(context.embedder, texts, context.signal) : null;
  if (vectors && !vectors.ok && !isEmbedderUnavailable(vectors.error.code)) return vectors;
  const byText =
    vectors && vectors.ok
      ? new Map(texts.map((text, index) => [text, vectors.value[index] as Float32Array]))
      : new Map<string, Float32Array>();
  const reranks = new Map((input.rerank ?? []).map((entry) => [entry.slotId as string, entry.order]));
  const reserved = [...(input.reserved ?? new Map<string, string>())];
  const excludedFor = (slotId: string) =>
    reserved.length === 0
      ? input.excluded
      : new Set([...input.excluded, ...reserved.flatMap(([key, owner]) => (owner === slotId ? [] : [key]))]);
  const results = await Promise.all(
    specs.map((spec) =>
      gatherPool(
        {
          slot: spec,
          vector: spec.intentText ? (byText.get(spec.intentText) ?? null) : null,
          locked: input.locked.get(spec.index) ?? null,
          rerank: reranks.get(spec.slotId) ?? null,
        },
        input.scope,
        excludedFor(spec.slotId),
        context,
      ),
    ),
  );
  const pools: SlotPool[] = [];
  for (const pool of results) {
    if (!pool.ok) return pool;
    pools.push(pool.value);
  }
  const unlocked = pools.filter((pool) => !pool.locked);
  const strictKeys = new Set(
    unlocked.flatMap((pool) => (pool.relaxed ? [] : pool.candidates.map((candidate) => candidate.key))),
  );
  if (strictKeys.size > 0 && strictKeys.size < unlocked.length) {
    const widened = await Promise.all(
      pools.map((pool) => {
        if (pool.locked || pool.relaxed) return Promise.resolve(ok(pool));
        const spec = pool.slot;
        return gatherPool(
          {
            slot: spec,
            vector: spec.intentText ? (byText.get(spec.intentText) ?? null) : null,
            locked: null,
            rerank: reranks.get(spec.slotId) ?? null,
          },
          input.scope,
          excludedFor(spec.slotId),
          context,
          true,
        );
      }),
    );
    pools.length = 0;
    for (const pool of widened) {
      if (!pool.ok) return pool;
      pools.push(pool.value);
    }
  }
  // FIX-STORY: a word's rarity is among every shot the cast weighs, so it is read once all pools are in.
  return ok(withTerms(pools, context).pools);
}
