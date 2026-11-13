// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Core's InterchangeMediaSource (P3-V5, TL4) in the agent process: each asset's original as an OpenTimelineIO
 * or FCPXML file names it. `path` is a location that is present on an online source (the managed copy first,
 * then the most recently seen); `lastKnownPath` is the most recently seen location's path, kept for an offline
 * original so another editor can relink it. Never a proxy or any derived file. The media facts are the
 * library's columns: the frame grid, the duration in its frames, the upright size and whether it has sound.
 */
import {
  frameRateSchema,
  ok,
  parseId,
  RationalTime,
  rationalTimeSchema,
  toTaalcutError,
  err,
  type AssetId,
  type FrameRate,
  type InterchangeMedia,
  type InterchangeMediaSource,
} from '@taalcut/core';
import type { LibraryDatabase } from '../db/database';
import type { SqlRow } from '../driver/types';

const IN_JSON = 'IN (SELECT value FROM json_each(?))';

const ASSETS = `SELECT id, kind, original_filename, width, height, has_audio, frame_rate_num, frame_rate_den,
  duration_value, duration_rate_num, duration_rate_den FROM assets WHERE id ${IN_JSON}`;

/** Newest sighting first; a present location on an online source is the original's path. */
const LOCATIONS = `SELECT l.asset_id, l.absolute_path_cached AS path, l.storage,
  (l.state = 'present' AND s.status = 'online') AS online
  FROM asset_locations l JOIN sources s ON s.id = l.source_id
  WHERE l.asset_id ${IN_JSON} AND l.absolute_path_cached IS NOT NULL
  ORDER BY l.asset_id, coalesce(l.last_seen_at, l.first_seen_at, 0) DESC, l.id`;

interface Paths {
  path: string | null;
  lastKnownPath: string | null;
  managedOnline: boolean;
}

function rateOf(row: SqlRow): FrameRate | null {
  const rate = frameRateSchema.safeParse({ num: row.frame_rate_num, den: row.frame_rate_den });
  return rate.success ? rate.data : null;
}

/** The duration in frames of the asset's own grid; null for a still, or without a grid. */
function framesOf(row: SqlRow, rate: FrameRate | null): number | null {
  if (!rate) return null;
  const duration = rationalTimeSchema.safeParse({
    value: row.duration_value,
    rate: { num: row.duration_rate_num, den: row.duration_rate_den },
  });
  return duration.success ? RationalTime.toFrames(duration.data, rate) : null;
}

const count = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;

function pathsByAsset(db: LibraryDatabase, ids: string): Map<string, Paths> {
  const out = new Map<string, Paths>();
  for (const row of db.driver.prepare(LOCATIONS).all(ids)) {
    const id = String(row.asset_id);
    const path = typeof row.path === 'string' ? row.path : null;
    const paths = out.get(id) ?? { path: null, lastKnownPath: path, managedOnline: false };
    const online = row.online === 1;
    if (online && !paths.managedOnline && (paths.path === null || row.storage === 'managed')) {
      paths.path = path;
      paths.managedOnline = row.storage === 'managed';
    }
    out.set(id, paths);
  }
  return out;
}

export function resolveInterchangeMedia(
  db: LibraryDatabase,
  assetIds: readonly AssetId[],
): Map<AssetId, InterchangeMedia> {
  const ids = JSON.stringify([...new Set(assetIds)]);
  const paths = pathsByAsset(db, ids);
  const media = new Map<AssetId, InterchangeMedia>();
  for (const row of db.driver.prepare(ASSETS).all(ids)) {
    const id = parseId<'Asset'>(row.id);
    if (!id.ok) continue;
    const found = paths.get(id.value);
    const rate = rateOf(row);
    media.set(id.value, {
      path: found?.path ?? null,
      lastKnownPath: found?.lastKnownPath ?? null,
      name: String(row.original_filename),
      rate,
      durationFrames: framesOf(row, rate),
      width: count(row.width),
      height: count(row.height),
      hasAudio: row.has_audio === 1 || row.kind === 'audio',
      // The library keeps no channel layout or sample rate yet: the writers leave them to the other editor.
      audioChannels: null,
      audioRate: null,
    });
  }
  return media;
}

export function createInterchangeMediaSource(db: LibraryDatabase): InterchangeMediaSource {
  return {
    async resolve(assetIds) {
      try {
        return ok(resolveInterchangeMedia(db, assetIds));
      } catch (cause) {
        return err(toTaalcutError(cause));
      }
    },
  };
}
