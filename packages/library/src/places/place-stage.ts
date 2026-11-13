// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The `library.place` index stage and its job, `library.placeAsset` (LIB1-PLACE), in the jobs process. After
 * media.normalise stored the clip's facts, the job names the city its own coordinates are in (geocode.ts) and keeps
 * it in `asset_places.own`, then asks for a refresh of every clip's place and trip (refresh.ts), which settles what
 * a clip borrows from its neighbours and groups the trips. Its stored output is the clip's own evidence: its city,
 * or the countries its own offset names, for stages that read it (a description's context, `storedPlace`).
 *
 * The refresh runs at once while it is quick (a library of a few thousand clips takes milliseconds); when it takes
 * longer, the jobs of an import share one run a moment after the last of them.
 */
import {
  defineError,
  defineIndexStage,
  defineJobKind,
  err,
  idSchema,
  NotFoundError,
  ok,
  PLACE_STAGE,
  placeStageOutputSchema,
  registerJob,
  stageJob,
  storedPlace,
  type AssetId,
  type AsyncResult,
  type EventBus,
  type IndexStageDefinition,
  type JobRegistration,
  type Place,
  type PlaceStageOutput,
} from '@taalcut/core';
import { z } from 'zod';
import type { LibraryDatabase } from '../db/database';
import { attemptWrite } from '../repositories/shared';
import { loadPlaces } from './dataset';
import { createGeocoder, type Geocoder } from './geocode';
import { refreshPlaces } from './refresh';
import { createZoneHints, type ZoneHints } from './zones';

export const PlacesUnavailable = defineError<{ path: string }>('library.places_unavailable', {
  retryable: false,
});

export const placeAssetJob = defineJobKind({
  kind: 'library.placeAsset',
  input: z.object({ assetId: idSchema<'Asset'>(), generation: z.int().nonnegative() }),
  output: placeStageOutputSchema,
  resource: 'io',
  priority: 'low',
});

/** Bump when the dataset or the naming changes, so every clip is named again. */
export const PLACE_STAGE_VERSION = 1;

export const placeStage: IndexStageDefinition = defineIndexStage({
  stage: PLACE_STAGE,
  version: PLACE_STAGE_VERSION,
  // The facts: coordinates, the capture time and its offset.
  reads: ['media.normalise'],
  needs: ['media.normalise'],
  stores: (view) => storedPlace(view),
  appliesTo: ['video', 'image', 'live_photo'],
  // Complete-only, so low (IX-R2): every clip becomes searchable first; naming a place then takes milliseconds.
  priority: 'low',
  milestone: 'complete',
  job: (view) => stageJob(placeAssetJob, { assetId: view.assetId, generation: view.generation }),
  result: () => ok({}),
});

export interface PlacesRuntime {
  readonly geocoder: Geocoder;
  readonly zones: ZoneHints;
}

/** The dataset, read on first use and kept; null once it couldn't be read (the error says where). */
export function lazyPlaces(path: string): () => PlacesRuntime | null {
  let runtime: PlacesRuntime | null | undefined;
  return () => {
    if (runtime === undefined) {
      try {
        const dataset = loadPlaces(path);
        runtime = { geocoder: createGeocoder(dataset), zones: createZoneHints(dataset) };
      } catch (cause) {
        console.warn(`[library] places dataset unavailable at ${path}: ${String(cause)}`);
        runtime = null;
      }
    }
    return runtime;
  };
}

export interface PlaceRefresher {
  /** A clip's place changed: refresh now, or soon when refreshes are slow. */
  request(): void;
  /** Runs any pending refresh now (tests, shutdown). */
  flush(): void;
  stop(): void;
}

/** A refresh quicker than this runs with each job; slower ones wait for a quiet moment. */
const QUICK_MS = 25;
const SETTLE_MS = 2000;

export function createPlaceRefresher(deps: {
  readonly db: LibraryDatabase;
  readonly places: () => PlacesRuntime | null;
  readonly events?: Pick<EventBus, 'emit'>;
  readonly homeZone?: string;
  readonly log?: (message: string) => void;
}): PlaceRefresher {
  let lastMs = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const run = () => {
    timer = null;
    const places = deps.places();
    if (!places) return;
    const started = performance.now();
    const done = refreshPlaces(deps.db, {
      countriesAt: (offset, at) => places.zones.countriesAt(offset, at),
      ...(deps.homeZone ? { homeZone: deps.homeZone } : {}),
      ...(deps.events ? { events: deps.events } : {}),
    });
    lastMs = performance.now() - started;
    if (!done.ok) deps.log?.(`places refresh failed: ${done.error.code}`);
  };
  return {
    request() {
      if (timer) return;
      if (lastMs < QUICK_MS) run();
      else {
        timer = setTimeout(run, Math.max(SETTLE_MS, lastMs * 10));
        timer.unref?.();
      }
    },
    flush() {
      if (timer) clearTimeout(timer);
      run();
    },
    stop() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

interface AssetFacts {
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly capturedAt: number | null;
  readonly fileOffset: number | null;
}

/** The clip's own evidence: its coordinates' city, else the countries its own offset names. */
export function ownPlace(asset: AssetFacts, places: PlacesRuntime): Place | null {
  if (asset.latitude !== null && asset.longitude !== null) {
    const gps = places.geocoder.placeAt(asset.latitude, asset.longitude);
    if (gps) return gps;
  }
  // The offset the file names (LIB1-OEM's MediaFacts.captureOffsetMin): absent is unknown; 0 is UTC itself.
  const offset = typeof asset.fileOffset === 'number' ? asset.fileOffset : null;
  if (offset === null || asset.capturedAt === null) return null;
  const countries = places.zones.countriesAt(offset, asset.capturedAt);
  return countries.length > 0
    ? { basis: 'zone', offsetMin: offset, offsetFrom: 'file', countries: [...countries] }
    : null;
}

export async function placeAsset(
  deps: { readonly db: LibraryDatabase; readonly places: () => PlacesRuntime | null; readonly path: string },
  input: { readonly assetId: AssetId },
): AsyncResult<PlaceStageOutput> {
  const places = deps.places();
  if (!places) return err(PlacesUnavailable({ path: deps.path }));
  const row = deps.db.driver
    .prepare(
      `SELECT latitude, longitude, capture_time AS capturedAt,
         json_extract(facts, '$.captureOffsetMin') AS fileOffset FROM assets WHERE id = ?`,
    )
    .get(input.assetId) as AssetFacts | undefined;
  if (!row) return err(NotFoundError({ entity: 'asset', id: input.assetId }));
  const place = ownPlace(row, places);
  const own = place?.basis === 'gps' ? JSON.stringify(place) : null;
  const stored = attemptWrite(deps.db, 'asset', () =>
    deps.db.driver
      .prepare(
        `INSERT INTO asset_places (asset_id, own, updated_at) VALUES (?, ?, ?)
         ON CONFLICT (asset_id) DO UPDATE SET own = excluded.own, updated_at = excluded.updated_at
         WHERE own IS NOT excluded.own`,
      )
      .run(input.assetId, own, deps.db.clock()),
  );
  if (!stored.ok) return stored;
  return ok({ place });
}

/** The job's registration: name the clip, then refresh the library's places and trips. */
export function placeJobs(deps: {
  readonly db: LibraryDatabase;
  readonly places: () => PlacesRuntime | null;
  readonly path: string;
  readonly refresher: PlaceRefresher;
}): JobRegistration[] {
  return [
    registerJob(placeAssetJob, async (input) => {
      const done = await placeAsset(deps, input);
      if (done.ok) deps.refresher.request();
      return done;
    }),
  ];
}
