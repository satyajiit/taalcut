// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The casting engine's read port over the library (SPEC, "Casting engine").
 * The engine embeds slot intents itself with core's Embedder and asks the
 * catalogue for the nearest shots, their profiles and the newest shots'
 * vectors (hook novelty). `createMemoryShotCatalog` is the in-memory
 * reference used by tests; `vectorShotCatalog` adapts core's VectorIndex.
 */
import {
  ok,
  RationalTime,
  type AsyncResult,
  type ShotProfile,
  type ShotProfileFilter,
  type ShotProfileRef,
} from '@taalcut/core';

export interface CatalogHit {
  readonly profile: ShotProfile;
  /** Cosine similarity to the query, −1..1. */
  readonly cosine: number;
}

export interface ShotCatalog {
  /** The k shots nearest `query` that pass `filter`, nearest first. */
  nearest(query: Float32Array, filter: ShotProfileFilter, k: number, signal?: AbortSignal): AsyncResult<CatalogHit[]>;
  /** Shots that pass `filter`, oldest capture first (story order's pool). */
  list(filter: ShotProfileFilter, limit: number, signal?: AbortSignal): AsyncResult<ShotProfile[]>;
  profiles(refs: readonly ShotProfileRef[], signal?: AbortSignal): AsyncResult<ShotProfile[]>;
  /** The newest shots' vectors by capture time, for the hook's novelty. */
  recent(limit: number, signal?: AbortSignal): AsyncResult<Float32Array[]>;
}

export function profileKey(profile: Pick<ShotProfile, 'assetId' | 'shotId'>): string {
  return profile.shotId ?? `asset:${profile.assetId}`;
}

export function dot(a: Float32Array, b: Float32Array): number {
  const length = Math.min(a.length, b.length);
  let sum = 0;
  for (let index = 0; index < length; index++) sum += (a[index] as number) * (b[index] as number);
  return sum;
}

export const captureTime = (profile: ShotProfile): number => profile.capturedAt ?? profile.fileDate;

export function matchesFilter(profile: ShotProfile, filter: ShotProfileFilter): boolean {
  if (filter.exclude?.has(profileKey(profile))) return false;
  if (filter.orientations && !filter.orientations.includes(profile.orientation)) return false;
  if (filter.minQuality !== undefined && profile.quality < filter.minQuality) return false;
  if (filter.minDuration && profile.kind === 'video' && RationalTime.isBefore(profile.range.duration, filter.minDuration))
    return false;
  const at = captureTime(profile);
  if (filter.capturedFrom !== undefined && at < filter.capturedFrom) return false;
  if (filter.capturedTo !== undefined && at > filter.capturedTo) return false;
  if (filter.sourceIds && (!profile.sourceId || !filter.sourceIds.includes(profile.sourceId))) return false;
  if (filter.assetIds && !filter.assetIds.includes(profile.assetId)) return false;
  return true;
}

const byKey = (a: ShotProfile, b: ShotProfile) => (profileKey(a) < profileKey(b) ? -1 : 1);

/** An in-memory catalogue: brute-force cosine over the given profiles. */
export function createMemoryShotCatalog(profiles: readonly ShotProfile[]): ShotCatalog {
  const index = new Map<string, ShotProfile>();
  for (const profile of profiles) {
    index.set(profileKey(profile), profile);
    const assetKey = `asset:${profile.assetId}`;
    if (!index.has(assetKey)) index.set(assetKey, profile);
  }
  return {
    async nearest(query, filter, k) {
      const hits = profiles
        .filter((profile) => matchesFilter(profile, filter))
        .map((profile) => ({ profile, cosine: dot(query, profile.embedding) }))
        .sort((a, b) => b.cosine - a.cosine || byKey(a.profile, b.profile));
      return ok(hits.slice(0, k));
    },
    async list(filter, limit) {
      const pool = profiles
        .filter((profile) => matchesFilter(profile, filter))
        .sort((a, b) => captureTime(a) - captureTime(b) || byKey(a, b));
      return ok(pool.slice(0, limit));
    },
    async profiles(refs) {
      return ok(refs.flatMap((ref) => index.get(ref.shotId ?? `asset:${ref.assetId}`) ?? []));
    },
    async recent(limit) {
      const newest = [...profiles].sort((a, b) => captureTime(b) - captureTime(a) || byKey(a, b));
      return ok(newest.slice(0, limit).map((profile) => profile.embedding));
    },
  };
}

