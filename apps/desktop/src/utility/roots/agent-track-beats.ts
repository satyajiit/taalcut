// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The beat map for the user's own track (music path b), for timeline's `trackBeats`: read from the asset row
 * when the library already has one, else tracked once by audio's tracker as a job in the jobs process and
 * stored on the asset, so choosing the same song again never runs the tracker twice (P3-B1 leftover).
 */
import {
  err,
  JobRunnerToken,
  NotFoundError,
  ok,
  type AssetId,
  type AsyncResult,
  type BeatMap,
  type Container,
  type JobRunner,
} from '@taalcut/core';
import { audioTrackBeatsJob } from '@taalcut/audio';
import {
  createAssetLocationRepository,
  createAssetRepository,
  type AssetLocationRepository,
  type AssetRepository,
} from '@taalcut/library';
import { LibraryDatabaseToken } from '../../shared/tokens';

export interface StoredBeatTrackerDeps {
  /** Resolved per call: the library and the job runner may come up after the commands are registered. */
  readonly assets: () => Pick<AssetRepository, 'get' | 'beatMap' | 'setBeatMap'>;
  readonly locations: () => Pick<AssetLocationRepository, 'listByAsset'>;
  readonly jobs: () => Pick<JobRunner, 'run'>;
}

export type TrackBeats = (assetId: AssetId, signal?: AbortSignal) => AsyncResult<BeatMap | null>;

export function storedBeatTracker(deps: StoredBeatTrackerDeps): TrackBeats {
  return async (assetId, signal) => {
    const assets = deps.assets();
    const asset = assets.get(assetId);
    if (asset.ok) {
      const cached = assets.beatMap(asset.value);
      if (cached) return ok(cached);
    }
    const found = deps
      .locations()
      .listByAsset(assetId)
      .find((location) => location.state === 'present' && location.absolutePathCached);
    if (!found?.absolutePathCached) return err(NotFoundError({ entity: 'asset', id: assetId }));
    const tracked = await deps
      .jobs()
      .run(audioTrackBeatsJob, { path: found.absolutePathCached }, signal ? { signal } : {});
    if (!tracked.ok) return tracked;
    if (tracked.value.beatMap) {
      const stored = assets.setBeatMap(assetId, tracked.value.beatMap);
      // A map that can't be stored is still this choice's beat map; the next choice tracks again.
      if (!stored.ok) console.warn(`[timeline] beat map not stored: ${stored.error.code}`);
    }
    return ok(tracked.value.beatMap);
  };
}

/** The tracker over the agent process's library database and job runner. */
export function libraryBeatTracker(container: Container): TrackBeats {
  return storedBeatTracker({
    assets: () => createAssetRepository(container.resolve(LibraryDatabaseToken)),
    locations: () => createAssetLocationRepository(container.resolve(LibraryDatabaseToken)),
    jobs: () => container.resolve(JobRunnerToken),
  });
}
