// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Frame sampler and grade-LUT sink for vision.measureLook and vision.bakeGrade.
 * The original comes from a present library location (a managed copy first).
 * The still is a PNG from media's frame extract (VideoToolbox first). The cube
 * goes into the derived-file cache. Nothing here opens ffmpeg at construction.
 */
import type { AssetId, Container } from '@taalcut/core';
import { ok } from '@taalcut/core';
import { createAssetLocationRepository, LibraryDatabaseToken } from '@taalcut/library';
import type { DerivedCache, MediaService } from '@taalcut/media';
import { createStillLookFrames, gradeLutFromCache, type LookJobDeps } from '@taalcut/vision';

/** Longest side of a look still. SPEC P3.5 samples around 270×480. */
const LOOK_EDGE = 480;

function presentPath(
  rows: readonly {
    readonly state: string;
    readonly storage: string;
    readonly absolutePathCached: string | null;
  }[],
): string | undefined {
  const present = rows.filter(
    (row) => row.state === 'present' && row.absolutePathCached !== null && row.absolutePathCached.length > 0,
  );
  const managed = present.find((row) => row.storage === 'managed');
  return (managed ?? present[0])?.absolutePathCached ?? undefined;
}

export function createDesktopLookPorts(
  container: Container,
  media: MediaService,
  cache: DerivedCache,
): LookJobDeps {
  let locations: ReturnType<typeof createAssetLocationRepository> | undefined;
  return {
    frames: createStillLookFrames({
      pathOf: async (assetId: AssetId) => {
        if (!container.has(LibraryDatabaseToken)) return undefined;
        locations ??= createAssetLocationRepository(container.resolve(LibraryDatabaseToken));
        return presentPath(locations.listByAsset(assetId));
      },
      still: {
        png: async (path, atSeconds, signal) => {
          const frame = await media.extractFrame(
            path,
            { value: Math.round(atSeconds * 1_000_000), rate: 1_000_000 },
            { format: 'png', maxDimension: LOOK_EDGE, signal },
          );
          if (!frame.ok) return frame;
          return ok(frame.value.data);
        },
      },
    }),
    luts: gradeLutFromCache((key, body) => cache.put(key, body)),
  };
}
