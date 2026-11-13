// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Refresh policy over core's HubIndexCache (P3-B12). The index is refetched when it is older than 10 minutes,
 * with If-None-Match; 304 keeps the body. A retryable failure keeps serving the cached index. Ratings that can't
 * be fetched fall back to the last ratings this install saw, else none: browse then shows no stars.
 */
import {
  err,
  HubIntegrity,
  hubIndexSchema,
  hubRatingsSchema,
  ok,
  type AsyncResult,
  type Clock,
  type HubIndex,
  type HubIndexCache,
  type HubRating,
} from '@taalcut/core';
import { hubInvalidFrom } from './hub-invalid';
import type { HubTransport } from './hub-transport';

export const HUB_INDEX_TTL_MS = 10 * 60 * 1000;

export interface CachedIndex {
  readonly index: HubIndex;
  readonly fetchedAt: number;
  readonly etag: string | null;
}

export type RatingsTable = Readonly<Record<string, HubRating>>;

export interface HubIndexClient {
  loadIndex(options?: { readonly force?: boolean }): AsyncResult<CachedIndex>;
  /** The index as cached, without fetching; null when nothing valid is cached. */
  cachedIndex(): AsyncResult<CachedIndex | null>;
  /** Null when ratings can't be fetched and none are cached. */
  loadRatings(): AsyncResult<RatingsTable | null>;
}

interface IndexClientDeps {
  readonly cache: HubIndexCache;
  readonly transport: HubTransport;
  readonly clock: Clock;
}

async function readCachedIndex(cache: HubIndexCache): AsyncResult<CachedIndex | null> {
  const stored = await cache.readIndex();
  if (!stored.ok) return stored;
  if (!stored.value) return ok(null);
  const parsed = hubIndexSchema.safeParse(stored.value.body);
  // A cached body this build can't read (an older shape): treated as no cache, so the next load refetches it.
  if (!parsed.success) return ok(null);
  return ok({ index: parsed.data, fetchedAt: stored.value.fetchedAt, etag: stored.value.etag });
}

async function keep(deps: IndexClientDeps, index: HubIndex, etag: string | null): AsyncResult<CachedIndex> {
  const document = { index, etag, fetchedAt: deps.clock.now() };
  const written = await deps.cache.writeIndex({ etag, fetchedAt: document.fetchedAt, body: index });
  return written.ok ? ok(document) : written;
}

async function loadIndex(
  deps: IndexClientDeps,
  options?: { readonly force?: boolean },
): AsyncResult<CachedIndex> {
  const cached = await readCachedIndex(deps.cache);
  if (!cached.ok) return cached;
  const current = cached.value;
  if (current && !options?.force && deps.clock.now() - current.fetchedAt < HUB_INDEX_TTL_MS)
    return ok(current);

  const fetched = await deps.transport.index(current?.etag ?? null);
  if (!fetched.ok) return current && fetched.error.retryable ? ok(current) : fetched;
  if (fetched.value.status === 304)
    return current ? keep(deps, current.index, fetched.value.etag ?? current.etag) : err(HubIntegrity());
  const parsed = hubIndexSchema.safeParse(fetched.value.body);
  return parsed.success ? keep(deps, parsed.data, fetched.value.etag) : err(hubInvalidFrom(parsed.error));
}

async function loadRatings(deps: IndexClientDeps): AsyncResult<RatingsTable | null> {
  const fetched = await deps.transport.ratings();
  if (fetched.ok) {
    const written = await deps.cache.writeRatings({
      etag: null,
      fetchedAt: deps.clock.now(),
      body: fetched.value,
    });
    return written.ok ? ok(fetched.value.ratings) : written;
  }
  const stored = await deps.cache.readRatings();
  if (!stored.ok) return stored;
  const parsed = stored.value ? hubRatingsSchema.safeParse(stored.value.body) : null;
  return ok(parsed?.success ? parsed.data.ratings : null);
}

export function createHubIndexClient(deps: IndexClientDeps): HubIndexClient {
  return {
    loadIndex: (options) => loadIndex(deps, options),
    cachedIndex: () => readCachedIndex(deps.cache),
    loadRatings: () => loadRatings(deps),
  };
}
