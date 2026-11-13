// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The casting engine (P2-M2, M12): template + library → 1–10 variants, each a
 * pick per slot with three alternates and a confidence. It runs in the agent
 * process over the ShotCatalog port and core's Embedder; it calls no model
 * (the Librarian reranks low-confidence slots and casts again).
 */
import {
  err,
  newId,
  ok,
  ValidationError,
  type AsyncResult,
  type Canvas,
  type CastCandidate,
  type CastId,
  type ShotProfile,
  type ShotProfileFilter,
} from '@taalcut/core';
import { NoCandidates } from '../errors';
import { inContext, toCastCandidate, type Adjacency } from './alternates';
import {
  embedAll,
  fitsSlot,
  gatherPool,
  scoreCandidate,
  withTerms,
  type Candidate,
  type CandidateContext,
  type SlotPool,
} from './candidates';
import { profileKey } from './catalog';
import { CASTING_CONFIG, type CastingConfig } from './config';
import { followedOrientation, madeCanvas } from './follow-canvas';
import { withNeedVectors } from './needs';
import { buildVariant, type CastVariant } from './result';
import { adjacencyPenalty } from './score';
import { orientationOf, slotSpecs, type SlotSpec } from './slots';
import { collapseDuplicates, planStory, storySearch, storyTargets } from './story';
import { castHookVariants, type HookVariantRequest } from './hook-variants';
import { planReranks, type RerankPlan } from './swaps';
import { lockedShots, templatePools } from './template-pools';
import { castVariants, type Variant, type VariantSearch } from './variants';
import { sequenceScore, type Sequence } from './beam';
import { staticCastingConfig, type ResolvedCastingConfig } from './learned/config-source';

import type {
  AlternatesRequest,
  CastingEngine,
  CastingEngineDeps,
  CastRequest,
  CastResult,
} from './engine-types';

export type {
  AlternatesRequest,
  CastingEngine,
  CastingEngineDeps,
  CastRequest,
  CastResult,
} from './engine-types';

function memoAdjacency(config: CastingConfig): Adjacency {
  const memo = new Map<string, number>();
  return (previous, next) => {
    const key = `${previous.key}|${next.key}`;
    let value = memo.get(key);
    if (value === undefined) {
      value = adjacencyPenalty(previous.profile, next.profile, config);
      memo.set(key, value);
    }
    return value;
  };
}

/** One cast's id, and the rerank as its swaps make it (FIX-STORY). */
interface CastRun {
  readonly id: () => CastId;
  readonly plan?: RerankPlan;
}

/** The plan's seed as candidates of these pools; none when the hook would be a gap or a shot would repeat. */
function seedOf(plan: RerankPlan | undefined, pools: readonly SlotPool[], adjacency: Adjacency) {
  if (!plan || plan.seed.length !== pools.length) return undefined;
  const picks = pools.map((pool, slot) => pool.candidates.find((c) => c.key === plan.seed[slot]) ?? null);
  const keys = picks.flatMap((pick) => (pick ? [pick.key] : []));
  if (!picks[0] || new Set(keys).size !== keys.length) return undefined;
  const seed: Sequence = { picks, score: sequenceScore(picks, adjacency) };
  return seed;
}

/** Locked slots keep their shot: the search sees it as the slot's only option. */
function withLocks(search: VariantSearch, locked: ReadonlyMap<number, Candidate>): VariantSearch {
  if (locked.size === 0) return search;
  return (constraints) =>
    search(constraints).map((sequence) => ({
      ...sequence,
      picks: sequence.picks.map((pick, slot) => locked.get(slot) ?? pick),
    }));
}

/** Every call resolves its config first (LRN1-PREF), then runs on an engine for that config. */
export function createCastingEngine(deps: CastingEngineDeps): CastingEngine {
  const config = deps.config ?? CASTING_CONFIG;
  const source = deps.configSource ?? staticCastingConfig(config);
  async function resolved<T>(
    signal: AbortSignal | undefined,
    run: (engine: CastingEngine) => AsyncResult<T>,
  ): AsyncResult<T> {
    const found = await source.resolve(signal);
    return found.ok ? run(engineFor(deps, found.value)) : found;
  }
  return {
    config,
    cast: (request, signal) => resolved(signal, (engine) => engine.cast(request, signal)),
    hookVariants: (request, signal) => resolved(signal, (engine) => engine.hookVariants(request, signal)),
    alternates: (request, signal) => resolved(signal, (engine) => engine.alternates(request, signal)),
    profiles: (refs, signal) => deps.catalog.profiles(refs, signal),
  };
}

function engineFor(deps: CastingEngineDeps, resolved: ResolvedCastingConfig): CastingEngine {
  const config = resolved.config;
  const castId = deps.ids?.cast ?? (() => newId<'Cast'>());

  async function storyPool(
    request: CastRequest,
    specs: readonly SlotSpec[],
    filter: ShotProfileFilter,
    context: CandidateContext,
  ) {
    const limit = config.candidates.storyPoolLimit;
    const query = request.pool?.query?.trim();
    const vector = query ? await embedAll(deps.embedder, [query], context.signal) : null;
    if (vector && !vector.ok) return vector;
    const fetchProfiles = async (activeFilter: ShotProfileFilter) => {
      if (vector) {
        const hits = await deps.catalog.nearest(
          vector.value[0] as Float32Array,
          activeFilter,
          limit,
          context.signal,
        );
        return hits.ok ? ok(hits.value.map((hit) => hit.profile)) : hits;
      }
      return deps.catalog.list(activeFilter, limit, context.signal);
    };
    const strict = await fetchProfiles(filter);
    if (!strict.ok) return strict;
    const shortest = [...specs].sort((a, b) => a.frames - b.frames)[0];
    const fitsShortest = (profile: ShotProfile) => !shortest || fitsSlot(profile, shortest);
    let combined = collapseDuplicates(strict.value.filter(fitsShortest));
    if (combined.length < specs.length && filter.orientations !== undefined) {
      const { orientations: _ignored, ...relaxedFilter } = filter;
      const relaxed = await fetchProfiles(relaxedFilter);
      if (!relaxed.ok) return relaxed;
      const seen = new Set(combined.map((p) => `${p.assetId}:${p.shotId}`));
      const extra = relaxed.value.filter(
        (p) => !seen.has(`${p.assetId}:${p.shotId}`) && fitsShortest(p),
      );
      combined = collapseDuplicates([...combined, ...extra]);
    }
    return ok(combined);
  }

  /**
   * FIX-STORY: a template rerank is read on the cast the Librarian reranked (the same cast without it), so a
   * rerank that puts another slot's pick first swaps the two slots (swaps.ts).
   */
  async function cast(request: CastRequest, signal?: AbortSignal): AsyncResult<CastResult> {
    if (request.mode !== 'template' || !request.rerank || request.rerank.length === 0)
      return castFor(request, { id: castId }, signal);
    const { rerank, ...plain } = request;
    const base = await castFor(plain, { id: () => '' as CastId }, signal);
    if (!base.ok) return base;
    return castFor(request, { id: castId, plan: planReranks(rerank, base.value.variants[0]) }, signal);
  }

  /**
   * BRK1-MAKE: a template cast mostly from clips of another orientation is cast again for a canvas of theirs, so the
   * made video follows the clips; a canvas the request names, and a story cast, keep theirs.
   */
  async function castFor(request: CastRequest, run: CastRun, signal?: AbortSignal): AsyncResult<CastResult> {
    const template = request.template;
    const named = request.canvas ? { ...template.canvas, ...request.canvas } : undefined;
    const first = await castOn(request, named ?? template.canvas, run, signal);
    if (!first.ok || named || request.mode !== 'template') return first.ok ? ok(first.value.result) : first;
    const follow = followedOrientation(first.value.picked, orientationOf(template.canvas));
    if (!follow) return ok(first.value.result);
    const again = await castOn(request, madeCanvas(template.canvas, follow), run, signal);
    return again.ok ? ok(again.value.result) : again;
  }

  async function castOn(
    request: CastRequest,
    canvas: Canvas,
    run: CastRun,
    signal?: AbortSignal,
  ): AsyncResult<{ result: CastResult; picked: ShotProfile['orientation'][] }> {
    if (!Number.isInteger(request.variants) || request.variants < 1 || request.variants > config.variants.max)
      return err(ValidationError({ field: 'variants' }));
    const template = request.template;
    const specs = slotSpecs(template, config, canvas);
    const recent = await deps.catalog.recent(config.hook.recentShots, signal);
    if (!recent.ok) return recent;
    const context: CandidateContext = {
      catalog: deps.catalog,
      embedder: deps.embedder,
      config,
      recent: recent.value,
      ...(signal ? { signal } : {}),
    };
    const locked = await lockedShots(request.locked ?? [], specs, context);
    if (!locked.ok) return locked;
    const lockedKeys = new Set([...locked.value.profiles.values()].map(profileKey));
    const excluded = new Set<string>([...(request.exclude ?? []), ...lockedKeys]);
    const scope = request.pool ?? {};
    const adjacency = memoAdjacency(config);

    let pools: SlotPool[];
    let search: VariantSearch | undefined;
    if (request.mode === 'template') {
      const rerank = run.plan ?? (request.rerank ? { rerank: request.rerank } : {});
      const made = await templatePools(
        { specs, locked: locked.value.profiles, ...rerank, scope, excluded },
        context,
      );
      if (!made.ok) return made;
      pools = made.value;
    } else {
      const filter: ShotProfileFilter = {
        orientations: [specs[0]?.orientation ?? 'portrait'],
        minQuality: config.candidates.qualityFloor,
        exclude: excluded,
        ...(scope.capturedFrom !== undefined ? { capturedFrom: scope.capturedFrom } : {}),
        ...(scope.capturedTo !== undefined ? { capturedTo: scope.capturedTo } : {}),
        ...(scope.sourceIds ? { sourceIds: scope.sourceIds } : {}),
      };
      const pool = await storyPool(request, specs, filter, context);
      if (!pool.ok) return pool;
      const plan = planStory(specs, pool.value, storyTargets(template, specs, config), context);
      pools = plan.pools;
      // Story order fills blocks by capture time; a locked slot keeps its shot over whatever its block gave.
      const lockedCandidates = new Map<number, Candidate>();
      for (const [index, profile] of locked.value.profiles) {
        const spec = specs[index] as SlotSpec;
        const candidate = scoreCandidate(spec, profile, null, context);
        lockedCandidates.set(index, candidate);
        pools[index] = { slot: spec, candidates: [candidate], locked: true, relaxed: false, reranked: false };
      }
      search = withLocks(storySearch(plan, adjacency, config), lockedCandidates);
    }

    if (pools.every((pool) => pool.candidates.length === 0)) return err(NoCandidates());
    const seed = seedOf(run.plan, pools, adjacency);
    const variants: Variant[] = castVariants(pools, request.variants, adjacency, config, search, seed);
    if (variants.length === 0) return err(NoCandidates());
    const built = variants.map((variant) =>
      buildVariant(variant, pools, locked.value.picks, {
        adjacency,
        config,
        canvasRate: template.canvas.rate,
      }),
    );
    // The first variant's picks: whose orientation the made video follows.
    const picked = (variants[0]?.sequence.picks ?? []).flatMap((pick) =>
      pick ? [pick.profile.orientation] : [],
    );
    const result: CastResult = {
      castId: run.id(),
      configVersion: resolved.label,
      weights: resolved.weights,
      mode: request.mode,
      variants: built,
      ...(built.length < request.variants
        ? { variantsShort: { asked: request.variants, made: built.length } }
        : {}),
      canvas,
    };
    return ok({ result, picked });
  }

  async function alternates(request: AlternatesRequest, signal?: AbortSignal): AsyncResult<CastCandidate[]> {
    const canvas = request.canvas ? { ...request.template.canvas, ...request.canvas } : undefined;
    const specs = slotSpecs(request.template, config, canvas);
    const named = specs.find((candidate) => candidate.slotId === request.slotId);
    if (!named) return err(ValidationError({ field: 'slotId' }));
    // FIX-HOOK: the slot's needs embedded, as a cast's are (falling back to lexical matching when the embedder is unavailable).
    const isEmbedderUnavailable = (code: string) =>
      code === 'vision.embedder_unavailable' || code === 'library.embedder_unavailable';
    const needed = await withNeedVectors([named], deps.embedder, signal);
    if (!needed.ok && !isEmbedderUnavailable(needed.error.code)) return needed;
    const spec = (needed.ok ? needed.value[0] : named) as SlotSpec;
    const recent = await deps.catalog.recent(config.hook.recentShots, signal);
    if (!recent.ok) return recent;
    const context: CandidateContext = {
      catalog: deps.catalog,
      embedder: deps.embedder,
      config,
      recent: recent.value,
      ...(signal ? { signal } : {}),
    };
    let vector: Float32Array | null = null;
    if (spec.intentText && needed.ok) {
      const embedded = await embedAll(deps.embedder, [spec.intentText], signal);
      if (!embedded.ok && !isEmbedderUnavailable(embedded.error.code)) return embedded;
      if (embedded.ok) vector = embedded.value[0] ?? null;
    }
    const exclude = new Set<string>([...request.used, ...request.exclude]);
    const slotRequest = { slot: spec, vector, locked: null, rerank: null };
    const gathered = await gatherPool(slotRequest, {}, exclude, context);
    if (!gathered.ok) return gathered;
    // FIX-STORY: the words count by their rarity among the shots this slot weighs.
    const pool = { value: withTerms([gathered.value], context).pools[0] as SlotPool };
    const neighbours = [request.previous, request.next].filter((ref) => ref !== null);
    const found = await deps.catalog.profiles(neighbours, signal);
    if (!found.ok) return found;
    const byKey = new Map(found.value.map((profile) => [profileKey(profile), profile]));
    const neighbour = (ref: AlternatesRequest['previous']) => {
      const profile = ref ? byKey.get(ref.shotId ?? `asset:${ref.assetId}`) : undefined;
      return profile ? scoreCandidate(spec, profile, null, context) : null;
    };
    const previous = neighbour(request.previous);
    const next = neighbour(request.next);
    const adjacency = memoAdjacency(config);
    const ranked = pool.value.candidates
      .map((candidate) => inContext(candidate, previous, next, adjacency))
      .sort((a, b) =>
        Math.abs(a.score - b.score) > config.tieEpsilon
          ? b.score - a.score
          : a.candidate.key < b.candidate.key
            ? -1
            : 1,
      );
    const out: CastCandidate[] = [];
    for (const entry of ranked) {
      if (out.length >= request.limit) break;
      const candidate = toCastCandidate(entry, pool.value, request.template.canvas.rate, config);
      if (candidate) out.push(candidate);
    }
    return ok(out);
  }

  async function hookVariants(request: HookVariantRequest, signal?: AbortSignal): AsyncResult<CastVariant[]> {
    if (!Number.isInteger(request.count) || request.count < 1 || request.count > config.variants.max)
      return err(ValidationError({ field: 'count' }));
    const recent = await deps.catalog.recent(config.hook.recentShots, signal);
    if (!recent.ok) return recent;
    const context: CandidateContext = {
      catalog: deps.catalog,
      embedder: deps.embedder,
      config,
      recent: recent.value,
      ...(signal ? { signal } : {}),
    };
    return castHookVariants(request, context, memoAdjacency(config));
  }

  return { config, cast, alternates, hookVariants };
}
