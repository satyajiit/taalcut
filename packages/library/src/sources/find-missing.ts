// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * "Find missing files" (ADR 0001, user gesture): `library.findMissingFiles`
 * looks under a folder the person picked for the bytes of missing locations.
 * Match order: the same relative path, then the partial hash as candidates,
 * then the full BLAKE3, which is required before a candidate is returned. The
 * person (or the agent) applies them with `library.relinkLocations`.
 */
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { ok, type AssetId, type AsyncResult, type SourceId } from '@taalcut/core';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import type { LibraryDatabase } from '../db/database';
import type { ContentHasher } from '../hashing/content-hasher';
import type { AssetLocationId } from '../ids';
import { assetLocations, assets } from '../schema/library';
import { walkMedia } from './walk';

export interface FindMissingRequest {
  readonly searchIn: string;
  readonly sourceId?: SourceId;
  readonly assetIds?: readonly AssetId[];
}

export interface MissingCandidate {
  readonly locationId: AssetLocationId;
  readonly path: string;
  readonly contentHash: string;
}

/** At most this many candidates per run (the job's output limit). */
export const MAX_MISSING_CANDIDATES = 5000;

interface Wanted {
  readonly locationId: AssetLocationId;
  readonly relativePath: string;
  readonly sizeBytes: number;
  readonly partialHashes: ReadonlySet<string>;
  readonly contentHash: string;
}

/** Missing locations whose asset's BLAKE3 is known (without it nothing could be verified). */
function wantedLocations(db: LibraryDatabase, request: FindMissingRequest): Wanted[] {
  return db.orm
    .select({ location: assetLocations, contentHash: assets.contentHash, assetPartial: assets.partialHash })
    .from(assetLocations)
    .innerJoin(assets, eq(assets.id, assetLocations.assetId))
    .where(
      and(
        eq(assetLocations.state, 'missing'),
        isNotNull(assets.contentHash),
        request.sourceId ? eq(assetLocations.sourceId, request.sourceId) : undefined,
        request.assetIds ? inArray(assetLocations.assetId, [...request.assetIds]) : undefined,
      ),
    )
    .all()
    .map((row) => ({
      locationId: row.location.id,
      relativePath: row.location.relativePath,
      sizeBytes: row.location.sizeBytes,
      partialHashes: new Set([row.location.partialHash, row.assetPartial].filter((h): h is string => !!h)),
      contentHash: row.contentHash!,
    }));
}

export async function findMissingFiles(
  deps: { readonly db: LibraryDatabase; readonly hasher: ContentHasher },
  request: FindMissingRequest,
  signal?: AbortSignal,
): AsyncResult<{ candidates: MissingCandidate[]; searched: number }> {
  const pending = new Map(wantedLocations(deps.db, request).map((w) => [w.locationId, w]));
  const candidates: MissingCandidate[] = [];
  let searched = 0;
  const options = signal ? { signal } : {};
  const verify = async (path: string, wanted: readonly Wanted[], size: number): Promise<void> => {
    const sized = wanted.filter((w) => w.sizeBytes === size && pending.has(w.locationId));
    if (sized.length === 0) return;
    const partial = await deps.hasher.partial(path, options);
    if (!partial.ok) return;
    const likely = sized.filter((w) => w.partialHashes.size === 0 || w.partialHashes.has(partial.value));
    if (likely.length === 0) return;
    const full = await deps.hasher.full(path, options);
    if (!full.ok) return;
    const match = likely.find((w) => w.contentHash === full.value);
    if (!match) return;
    pending.delete(match.locationId);
    candidates.push({ locationId: match.locationId, path, contentHash: full.value });
  };

  // 1. The same relative path under the folder (a drive mounted somewhere else, a renamed parent).
  for (const wanted of [...pending.values()]) {
    if (signal?.aborted || candidates.length >= MAX_MISSING_CANDIDATES) break;
    const path = join(request.searchIn, wanted.relativePath);
    const info = await stat(path).catch(() => undefined);
    if (info?.isFile()) await verify(path, [wanted], info.size);
  }

  // 2 and 3. Anything else under the folder whose size, partial hash and then BLAKE3 match.
  const bySize = new Map<number, Wanted[]>();
  for (const wanted of pending.values())
    bySize.set(wanted.sizeBytes, [...(bySize.get(wanted.sizeBytes) ?? []), wanted]);
  for await (const entry of walkMedia(request.searchIn, options)) {
    if (pending.size === 0 || candidates.length >= MAX_MISSING_CANDIDATES) break;
    searched += 1;
    const info = await stat(entry.absolutePath).catch(() => undefined);
    const wanted = info ? bySize.get(info.size) : undefined;
    if (info && wanted) await verify(entry.absolutePath, wanted, info.size);
  }
  return ok({ candidates, searched });
}
