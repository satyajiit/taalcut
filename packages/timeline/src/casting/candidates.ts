// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Casting step 1: per slot, the library's nearest shots to the embedded
 * intent (top k by cosine), filtered inside the search by orientation, usable
 * length, the quality floor, locks, exclusions and the pool. An empty slot
 * gets one relaxed pass that allows other orientations. Each candidate is
 * scored once here; the beam only adds penalties.
 */
import {
  chunk,
  err,
  ok,
  type AsyncResult,
  type Embedder,
  type ShotProfile,
  type ShotProfileFilter,
  type SourceId,
} from '@taalcut/core';
import type { CastingConfig } from './config';
import { dot, matchesFilter, profileKey, type ShotCatalog } from './catalog';
import { windowFrames } from './in-points';
import { unaryParts, unaryScore, type Parts } from './score';
import type { SlotSpec } from './slots';
import { unmetNeeds } from './needs';
import { termIndex, type TermIndex } from './terms';

export interface Candidate {
  readonly key: string;
  readonly profile: ShotProfile;
  /** Cosine to the slot's intent; null when the slot says nothing. */
  readonly cosine: number | null;
  readonly parts: Parts;
  /** The rerank bonus, when the slot was reranked. */
  readonly rerank: number | null;
  /** Unary score, the hook and rerank bonuses included. */
  readonly unary: number;
}

export interface SlotPool {
  readonly slot: SlotSpec;
  readonly candidates: readonly Candidate[];
  /** The user locked this slot's shot: its only candidate. */
  readonly locked: boolean;
  /** Filled only by allowing other orientations. */
  readonly relaxed: boolean;
  readonly reranked: boolean;
}

export interface PoolScope {
  readonly capturedFrom?: number;
  readonly capturedTo?: number;
  readonly sourceIds?: readonly SourceId[];
}

export interface CandidateContext {
  readonly catalog: ShotCatalog;
  readonly embedder: Embedder;
  readonly config: CastingConfig;
  readonly recent: readonly Float32Array[];
  readonly signal?: AbortSignal;
  /** FIX-STORY: the shots this cast weighs, for each word's rarity (terms.ts); absent, words don't count. */
  readonly terms?: TermIndex;
  /** FIX-HOOK: the slot's needs this shot doesn't meet while another in its pool does (withTerms); absent, none. */
  readonly unmet?: number;
}

/** Embeds texts in batches of the embedder contract's 64. */
export async function embedAll(
  embedder: Embedder,
  texts: readonly string[],
  signal?: AbortSignal,
): AsyncResult<Float32Array[]> {
  const vectors: Float32Array[] = [];
  for (const batch of chunk(texts, 64)) {
    const result = await embedder.embedTexts(batch, {
      purpose: 'query',
      ...(signal ? { signal } : {}),
    });
    if (!result.ok) return result;
    vectors.push(...result.value);
  }
  return ok(vectors);
}

export function scoreCandidate(
  slot: SlotSpec,
  profile: ShotProfile,
  cosine: number | null,
  context: Pick<CandidateContext, 'config' | 'recent' | 'terms' | 'unmet'>,
  rerank: number | null = null,
): Candidate {
  const parts = unaryParts(slot, profile, cosine, { ...context, hook: slot.index === 0 });
  const unary = unaryScore(parts, context.config) + (rerank ?? 0);
  return { key: profileKey(profile), profile, cosine, parts, rerank, unary };
}

/** Long enough for the slot at the shot's own frame rate (the in-point needs a whole window). */
export function fitsSlot(profile: ShotProfile, slot: SlotSpec): boolean {
  if (profile.kind === 'image') return true;
  return windowFrames(slot, profile.range.start.rate) <= profile.range.duration.value;
}

export function filterFor(
  slot: SlotSpec,
  scope: PoolScope,
  exclude: ReadonlySet<string>,
  config: CastingConfig,
  relaxed: boolean,
): ShotProfileFilter {
  return {
    ...(relaxed ? {} : { orientations: [slot.orientation] }),
    minDuration: slot.consumes,
    minQuality: config.candidates.qualityFloor,
    exclude,
    ...(scope.capturedFrom !== undefined ? { capturedFrom: scope.capturedFrom } : {}),
    ...(scope.capturedTo !== undefined ? { capturedTo: scope.capturedTo } : {}),
    ...(scope.sourceIds ? { sourceIds: scope.sourceIds } : {}),
  };
}

/** The slot's candidates by cosine, or (with no intent) the pool's best quality first. */
export async function nearestFor(
  slot: SlotSpec,
  vector: Float32Array | null,
  filter: ShotProfileFilter,
  context: CandidateContext,
): AsyncResult<{ profile: ShotProfile; cosine: number | null }[]> {
  const k = context.config.candidates.k;
  if (vector) {
    const hits = await context.catalog.nearest(vector, filter, k, context.signal);
    if (!hits.ok) return hits;
    return ok(hits.value.filter((hit) => fitsSlot(hit.profile, slot)));
  }
  const listed = await context.catalog.list(filter, context.config.candidates.storyPoolLimit, context.signal);
  if (!listed.ok) return listed;
  const best = listed.value
    .filter((profile) => fitsSlot(profile, slot))
    .sort((a, b) => b.quality - a.quality || (profileKey(a) < profileKey(b) ? -1 : 1))
    .slice(0, k);
  return ok(best.map((profile) => ({ profile, cosine: null })));
}

export interface SlotRequest {
  readonly slot: SlotSpec;
  readonly vector: Float32Array | null;
  readonly locked: ShotProfile | null;
  /** The five keys a rerank ordered, best first. */
  readonly rerank: readonly string[] | null;
}

export async function gatherPool(
  request: SlotRequest,
  scope: PoolScope,
  exclude: ReadonlySet<string>,
  context: CandidateContext,
  forceRelaxed = false,
): AsyncResult<SlotPool> {
  const { slot, vector } = request;
  const cosineOf = (profile: ShotProfile) => (vector ? dot(vector, profile.embedding) : null);
  if (request.locked) {
    const candidate = scoreCandidate(slot, request.locked, cosineOf(request.locked), context);
    return ok({ slot, candidates: [candidate], locked: true, relaxed: false, reranked: false });
  }
  let relaxed = false;
  const strict = await nearestFor(slot, vector, filterFor(slot, scope, exclude, context.config, false), context);
  if (!strict.ok) return strict;
  let hits = strict.value;
  if (forceRelaxed || hits.length === 0) {
    const any = await nearestFor(slot, vector, filterFor(slot, scope, exclude, context.config, true), context);
    if (!any.ok) return any;
    if (hits.length === 0) {
      hits = any.value;
      relaxed = true;
    } else {
      const seen = new Set(hits.map((hit) => profileKey(hit.profile)));
      for (const hit of any.value) {
        const key = profileKey(hit.profile);
        if (!seen.has(key)) {
          seen.add(key);
          hits.push(hit);
        }
      }
      hits = hits.slice(0, context.config.candidates.k);
      relaxed = hits.some((hit) => hit.profile.orientation !== slot.orientation);
    }
  }
  if (request.rerank) {
    const order = request.rerank.slice(0, context.config.rerank.count);
    const known = new Map(hits.map((hit) => [profileKey(hit.profile), hit]));
    const missing = order.filter((key) => !known.has(key));
    if (missing.length > 0) {
      const refs = missing.map((key) =>
        key.startsWith('asset:') ? { assetId: key.slice(6), shotId: null } : { assetId: '', shotId: key },
      );
      const fetched = await context.catalog.profiles(refs, context.signal);
      if (!fetched.ok) return err(fetched.error);
      // FIX-STORY: a shot from outside the slot's nearest (another slot's, in a swap) must fit the slot.
      const filter = filterFor(slot, scope, exclude, context.config, relaxed);
      for (const profile of fetched.value)
        if (matchesFilter(profile, filter) && fitsSlot(profile, slot))
          known.set(profileKey(profile), { profile, cosine: cosineOf(profile) });
    }
    const ordered = order
      .flatMap((key) => known.get(key) ?? [])
      .filter((hit) => !exclude.has(profileKey(hit.profile)));
    const { count, weight } = context.config.rerank;
    // An order none of whose shots can fill the slot is no rerank: the slot is cast as it would have been.
    if (ordered.length > 0) {
      const candidates = ordered.map((hit, rank) =>
        scoreCandidate(slot, hit.profile, hit.cosine, context, weight * (1 - rank / count)),
      );
      return ok({ slot, candidates, locked: false, relaxed, reranked: true });
    }
  }
  const candidates = hits.map((hit) => scoreCandidate(slot, hit.profile, hit.cosine, context));
  return ok({ slot, candidates, locked: false, relaxed, reranked: false });
}

/**
 * FIX-STORY: the pools scored again with each word's rarity among every shot they hold (each shot once): a
 * word counts by how few of the shots this cast weighs show it. Returns the index too.
 *
 * FIX-HOOK: and with what each slot needs its footage to show (SlotSpec.needs, needs.ts): a need some shot in the
 * slot's pool meets costs every shot there that doesn't `terms.requiredPenalty`. A need no shot meets costs none, so a
 * library without the thing casts as before; a locked slot keeps its shot.
 */
export function withTerms(
  pools: readonly SlotPool[],
  context: Pick<CandidateContext, 'config' | 'recent'>,
): { readonly pools: SlotPool[]; readonly terms: TermIndex } {
  const terms = termIndex(pools.flatMap((pool) => pool.candidates.map((candidate) => candidate.profile)));
  return {
    terms,
    pools: pools.map((pool) => {
      const unmet = pool.locked
        ? new Map<string, number>()
        : unmetNeeds(
            pool.slot.needs,
            pool.candidates.map((candidate) => candidate.profile),
            terms,
            context.config.terms,
          );
      return {
        ...pool,
        candidates: pool.candidates.map((candidate) => {
          const missed = unmet.get(candidate.key) ?? 0;
          const scored = { ...context, terms, ...(missed > 0 ? { unmet: missed } : {}) };
          return scoreCandidate(pool.slot, candidate.profile, candidate.cosine, scored, candidate.rerank);
        }),
      };
    }),
  };
}
