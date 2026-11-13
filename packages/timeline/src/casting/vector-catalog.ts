// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A ShotCatalog over core's VectorIndex (the active embedding space) and a
 * profile source the library implements. Exact search on the CPU is the
 * library's accepted ADR 0002 exception; casting itself is bookkeeping.
 * Until the index filters by orientation, length and quality inside the
 * search (casting research note), it reads `vectorOverfetch` × k and filters.
 */
import { ok, type ShotProfileSource, type VectorIndex } from '@taalcut/core';
import { dot, matchesFilter, profileKey, type ShotCatalog } from './catalog';
import { CASTING_CONFIG, type CastingConfig } from './config';

/** Vector ids are `<kind>:<key>[:<n>]` (e.g. `frame:<shotId>:0`): the key is the shot, or `asset:<id>`. */
function keyOf(id: string): string | null {
  const [, first, second] = id.split(':');
  if (!first) return null;
  return first === 'asset' && second ? `asset:${second}` : first;
}

const MAX_K = 4096;

export function vectorShotCatalog(deps: {
  readonly index: VectorIndex;
  readonly profiles: ShotProfileSource;
  readonly config?: CastingConfig;
}): ShotCatalog {
  const config = deps.config ?? CASTING_CONFIG;
  // Unit vectors in an L2 index: |a − b|² = 2 − 2·cos.
  const cosineOf = (distance: number) =>
    deps.index.metric === 'cosine' ? 1 - distance : 1 - (distance * distance) / 2;
  return {
    async nearest(query, filter, k, signal) {
      const searched = deps.index.search(query, {
        k: Math.min(MAX_K, k * config.candidates.vectorOverfetch),
        filter: { kind: 'frame', ...(filter.sourceIds ? { sourceId: filter.sourceIds } : {}) },
      });
      if (!searched.ok) return searched;
      const best = new Map<string, number>();
      // A photo's profile is keyed by its asset, but the library may embed a still as its one shot.
      const byAsset = new Map<string, number>();
      const raise = (map: Map<string, number>, key: string, cosine: number) =>
        map.set(key, Math.max(map.get(key) ?? Number.NEGATIVE_INFINITY, cosine));
      for (const match of searched.value) {
        const key = keyOf(match.id);
        if (!key) continue;
        raise(best, key, cosineOf(match.distance));
        if (match.metadata.assetId) raise(byAsset, match.metadata.assetId, cosineOf(match.distance));
      }
      const refs = [...best.keys()].map((key) =>
        key.startsWith('asset:')
          ? { assetId: key.slice('asset:'.length), shotId: null }
          : { assetId: '', shotId: key },
      );
      const found = await deps.profiles.profiles(refs, signal);
      if (!found.ok) return found;
      // FIX-CAST: a shot's words count as much as its frames. Vision's description of it (`description:<shotId>`)
      // says night, facing away and what happens far more plainly than a frame does to a line of text.
      const described = deps.index.get(
        found.value.flatMap((profile) => (profile.shotId ? [`description:${profile.shotId}`] : [])),
      );
      const words = described.ok ? described.value : new Map<string, Float32Array>();
      const cosineOfProfile = (profile: (typeof found.value)[number]) => {
        const frames =
          best.get(profileKey(profile)) ??
          (profile.shotId === null ? byAsset.get(profile.assetId) : undefined) ??
          0;
        const description = profile.shotId ? words.get(`description:${profile.shotId}`) : undefined;
        return description && description.length === query.length
          ? (frames + dot(query, description)) / 2
          : frames;
      };
      const hits = found.value
        .filter((profile) => matchesFilter(profile, filter))
        .map((profile) => ({ profile, cosine: cosineOfProfile(profile) }))
        .sort((a, b) => b.cosine - a.cosine || (profileKey(a.profile) < profileKey(b.profile) ? -1 : 1));
      return ok(hits.slice(0, k));
    },
    list: (filter, limit, signal) => deps.profiles.list(filter, limit, signal),
    profiles: (refs, signal) => deps.profiles.profiles(refs, signal),
    recent: (limit, signal) => deps.profiles.recent(limit, signal),
  };
}
