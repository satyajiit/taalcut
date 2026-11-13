// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Core's ShotProfileSource (P2-M2) over the library: what vision stored on
 * each shot (its analysis, quality, motion, energy, objects, near-duplicate
 * group), the asset's capture time, file date, orientation and source, and
 * the shot's direction in the active embedding space (the unit mean of its
 * frame vectors). Casting reads it in the agent process.
 *
 * A photo is profiled by its asset (`shotId` null, an empty range), though
 * vision stores a still as its asset's one shot; asking by that shot's id
 * finds the photo too. The 100 ms motion and sharpness curves and the
 * full-rate motion peaks are vision's, in the analysis (`signals`; empty
 * curves, past an hour, are null); place clusters group capture locations,
 * else the description's place (profile-signals.ts). The best frame is vision's sharpest sampled frame (the
 * `best_frame` column, else the analysis's), kept inside the shot (FIX-TRIM). Faces come from the description's people:
 * vision has no face pass (faces are opt-in, PRD).
 */
import {
  CAMERA_MOTIONS,
  CancelledError,
  SHOT_TYPES,
  err,
  ok,
  RationalTime,
  TimeRange,
  type AssetId,
  type CameraMotion,
  type Orientation,
  type ShotId,
  type ShotProfile,
  type ShotProfileFilter,
  type ShotProfileRef,
  type ShotProfileSource,
  type ShotType,
  type SourceId,
  type VectorIndex,
} from '@taalcut/core';
import { and, eq, inArray } from 'drizzle-orm';
import type { LibraryDatabase } from '../db/database';
import type { SqlValue } from '../driver/types';
import { OBJECT_SEPARATOR, shotAnalysis, shotRange, type Shot } from '../repositories/shots';
import { assetDuration } from '../repositories/stored-time';
import { assets, shots } from '../schema/library';
import { meanVector } from '../search/similar';
import { USER_IMPORTED_ASSET_SQL } from './filters';
import { createPlaceClusters, namedPlace } from './profile-signals';

export interface ShotProfileSourceDeps {
  readonly db: LibraryDatabase;
  /** The active embedding space's index, or a getter for one opened later. Absent: empty embeddings. */
  readonly vectors?: VectorIndex | (() => VectorIndex | null);
}

/** Vision embeds at most 8 frames per shot (vision SPEC, "What gets embedded"). */
const MAX_FRAMES = 8;
const MAX_LIMIT = 10_000;
/** SQLite's bound-parameter limit is far higher; chunks keep each statement small. */
const CHUNK = 500;

/** One row per shot of a video, one per photo (its still's shot), never trashed or hidden. */
const CASTABLE = `a.trashed_at IS NULL AND a.companion_of IS NULL AND a.kind != 'audio'
  AND (a.kind = 'video' OR s.index_in_asset = 0)`;
const CAPTURED = `COALESCE(a.capture_time,
  (SELECT min(l.mtime_ms) FROM asset_locations l WHERE l.asset_id = a.id), a.created_at)`;
const ORIENTATION = `COALESCE(a.orientation, json_extract(s.analysis, '$.orientation'), 'landscape')`;
const KEY = `CASE WHEN a.kind = 'video' THEN s.id ELSE 'asset:' || a.id END`;

type AssetRow = typeof assets.$inferSelect;

interface Located {
  readonly sourceId: SourceId | null;
  readonly fileDate: number | null;
}

const frameIds = (shotId: string) => Array.from({ length: MAX_FRAMES }, (_, n) => `frame:${shotId}:${n}`);
const chunks = <T>(items: readonly T[]) =>
  Array.from({ length: Math.ceil(items.length / CHUNK) }, (_, i) => items.slice(i * CHUNK, (i + 1) * CHUNK));
const marks = (n: number) => Array(n).fill('?').join(', ');
const clampLimit = (limit: number) => Math.max(0, Math.min(MAX_LIMIT, Math.floor(limit)));
const motionOf = (value: string | null): CameraMotion | null =>
  (CAMERA_MOTIONS as readonly string[]).includes(value ?? '') ? (value as CameraMotion) : null;
const shotTypeOf = (value: string | null): ShotType | null =>
  (SHOT_TYPES as readonly string[]).includes(value ?? '') ? (value as ShotType) : null;

export function createShotProfileSource(deps: ShotProfileSourceDeps): ShotProfileSource {
  const { db } = deps;
  const places = createPlaceClusters(db);
  const index = (): VectorIndex | null =>
    typeof deps.vectors === 'function' ? deps.vectors() : (deps.vectors ?? null);

  /** Each shot's unit mean frame vector; shots without vectors are absent. */
  function directions(shotIds: readonly string[]): Map<string, Float32Array> {
    const vectors = index();
    const out = new Map<string, Float32Array>();
    if (!vectors || shotIds.length === 0) return out;
    const read = vectors.get(shotIds.flatMap(frameIds));
    if (!read.ok) return out;
    for (const id of shotIds) {
      const mean = meanVector(frameIds(id).flatMap((frame) => read.value.get(frame) ?? []));
      if (mean) out.set(id, mean);
    }
    return out;
  }

  /** Each asset's source (a present location first) and its earliest file time. */
  function locate(assetIds: readonly AssetId[]): Map<string, Located> {
    const out = new Map<string, Located>();
    for (const part of chunks(assetIds)) {
      const rows = db.driver
        .prepare(
          `SELECT asset_id, source_id, mtime_ms FROM asset_locations WHERE asset_id IN (${marks(part.length)})
           ORDER BY state = 'present' DESC, first_seen_at, id`,
        )
        .all(...part);
      for (const row of rows) {
        const id = String(row.asset_id);
        const seen = out.get(id);
        const mtime = typeof row.mtime_ms === 'number' ? row.mtime_ms : null;
        const earlier = seen?.fileDate ?? null;
        const fileDate = mtime === null ? earlier : Math.min(mtime, earlier ?? mtime);
        out.set(id, { sourceId: seen?.sourceId ?? (row.source_id as SourceId), fileDate });
      }
    }
    return out;
  }

  /** FIX-TRIM: the stored best frame inside the shot (from its start, at its rate), or null when there is none. */
  const bestFrameOf = (frame: number | null, range: TimeRange) =>
    frame === null || !Number.isInteger(frame) || frame < 0
      ? null
      : Math.min(frame, Math.max(0, range.duration.value - 1));

  /** A stored curve, or null when there is none (an unanalysed shot, or one past an hour). */
  const curve = (values: readonly number[] | undefined) => (values && values.length > 0 ? [...values] : null);

  function toProfile(
    shot: Shot,
    asset: AssetRow,
    located: Located | undefined,
    place: string | null,
    vector?: Float32Array,
  ): ShotProfile {
    const photo = asset.kind !== 'video';
    const analysis = shotAnalysis(shot);
    const signals = analysis?.signals;
    const range = shotRange(shot);
    const zero = RationalTime.zero(range.start.rate);
    const duration = assetDuration(asset);
    const orientation: Orientation = asset.orientation ?? analysis?.orientation ?? 'landscape';
    return {
      assetId: asset.id,
      shotId: photo ? null : shot.id,
      kind: photo ? 'image' : 'video',
      range: photo ? TimeRange.of(zero, zero) : range,
      available: photo ? null : duration ? TimeRange.of(RationalTime.zero(duration.rate), duration) : range,
      orientation,
      quality: shot.quality ?? 0,
      sharpness: analysis?.quality.sharpness ?? 0,
      motionClass: motionOf(shot.motion),
      energy: shot.energy,
      faceCount: analysis?.description?.people ?? 0,
      placeClusterId: place,
      objectTags: shot.objects ? shot.objects.split(OBJECT_SEPARATOR).filter(Boolean) : [],
      // FIX-CAST: what casting reads for night or day, facing away and shot size.
      description: shot.description?.trim() || null,
      shotType: shotTypeOf(shot.shotType),
      capturedAt: asset.captureTime,
      fileDate: located?.fileDate ?? asset.createdAt,
      duplicateGroup: shot.duplicateGroup,
      bestTake: shot.bestTake,
      sourceId: located?.sourceId ?? null,
      embedding: vector ?? new Float32Array(0),
      motionCurve: photo ? null : curve(signals?.motionCurve),
      sharpnessCurve: photo ? null : curve(signals?.sharpnessCurve),
      motionPeakFrames: photo ? [] : [...(signals?.motionPeakFrames ?? [])],
      bestFrame: photo ? null : bestFrameOf(shot.bestFrame ?? analysis?.bestFrame ?? null, range),
    };
  }

  /** Profiles of these shots, in their order, one per photo, castable assets only. */
  function build(rows: readonly Shot[]): ShotProfile[] {
    const assetIds = [...new Set(rows.map((row) => row.assetId))];
    const byId = new Map<string, AssetRow>();
    for (const part of chunks(assetIds))
      for (const asset of db.orm.select().from(assets).where(inArray(assets.id, part)).all())
        byId.set(asset.id, asset);
    const located = locate(assetIds as AssetId[]);
    const vectors = directions(rows.map((row) => row.id));
    const clusters = places();
    const seen = new Set<string>();
    const out: ShotProfile[] = [];
    for (const row of rows) {
      const asset = byId.get(row.assetId);
      if (!asset || asset.kind === 'audio' || asset.trashedAt !== null || asset.companionOf !== null)
        continue;
      const place = clusters.get(asset.id) ?? namedPlace(row.place);
      const profile = toProfile(row, asset, located.get(asset.id), place, vectors.get(row.id));
      const key = profile.shotId ?? `asset:${profile.assetId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(profile);
    }
    return out;
  }

  /** Shots by id, kept in the order of `ids`. */
  function shotsById(ids: readonly string[]): Shot[] {
    const byId = new Map<string, Shot>();
    for (const part of chunks(ids))
      for (const row of db.orm
        .select()
        .from(shots)
        .where(inArray(shots.id, part as ShotId[]))
        .all())
        byId.set(row.id, row);
    return ids.flatMap((id) => byId.get(id) ?? []);
  }

  function photoShots(assetIds: readonly string[]): Shot[] {
    return chunks(assetIds).flatMap((part) =>
      db.orm
        .select()
        .from(shots)
        .where(and(inArray(shots.assetId, part as AssetId[]), eq(shots.indexInAsset, 0)))
        .all(),
    );
  }

  /** Whole-asset profiles for newly imported videos or images before `vision.shots` has indexed them. */
  function fallbackProfiles(assetIds: readonly string[]): ShotProfile[] {
    const rows = chunks(assetIds).flatMap((part) =>
      db.orm
        .select()
        .from(assets)
        .where(inArray(assets.id, part as AssetId[]))
        .all(),
    );
    const byId = new Map<string, (typeof rows)[number]>(rows.map((row) => [row.id, row]));
    const located = locate(assetIds as AssetId[]);
    const clusters = places();
    const fallbackRate = { num: 30, den: 1 } as const;
    const out: ShotProfile[] = [];
    for (const id of assetIds) {
      const asset = byId.get(id);
      if (!asset || asset.kind === 'audio' || asset.trashedAt !== null || asset.companionOf !== null)
        continue;
      const photo = asset.kind !== 'video';
      const duration = assetDuration(asset) ?? RationalTime.of(9000, fallbackRate);
      const zero = RationalTime.zero(photo ? fallbackRate : duration.rate);
      const range = photo ? TimeRange.of(zero, zero) : TimeRange.of(zero, duration);
      const orientation: Orientation =
        asset.orientation ??
        (asset.width && asset.height
          ? asset.width > asset.height
            ? 'landscape'
            : asset.height > asset.width
              ? 'portrait'
              : 'square'
          : 'landscape');
      const loc = located.get(asset.id);
      out.push({
        assetId: asset.id,
        shotId: null,
        kind: photo ? 'image' : 'video',
        range,
        available: photo ? null : range,
        orientation,
        quality: 0,
        sharpness: 0,
        motionClass: null,
        energy: null,
        faceCount: 0,
        placeClusterId: clusters.get(asset.id) ?? null,
        objectTags: [],
        description: null,
        shotType: null,
        capturedAt: asset.captureTime,
        fileDate: loc?.fileDate ?? asset.createdAt,
        duplicateGroup: null,
        bestTake: false,
        sourceId: loc?.sourceId ?? null,
        embedding: new Float32Array(0),
        motionCurve: null,
        sharpnessCurve: null,
        motionPeakFrames: [],
        bestFrame: null,
      });
    }
    return out;
  }

  return {
    async profiles(refs: readonly ShotProfileRef[], signal?: AbortSignal) {
      if (signal?.aborted) return err(CancelledError());
      const shotIds = [...new Set(refs.flatMap((ref) => (ref.shotId ? [ref.shotId] : [])))];
      const byAsset = [...new Set(refs.flatMap((ref) => (ref.shotId ? [] : [ref.assetId])))];
      const built = build([...shotsById(shotIds), ...photoShots(byAsset)]);
      const covered = new Set<string>(built.map((profile) => profile.assetId));
      const unindexed = byAsset.filter((id) => !covered.has(id));
      return ok(unindexed.length === 0 ? built : [...built, ...fallbackProfiles(unindexed)]);
    },

    async list(filter: ShotProfileFilter = {}, limit = 100, signal?: AbortSignal) {
      if (signal?.aborted) return err(CancelledError());
      const where = [CASTABLE];
      if (!filter.assetIds && !filter.sourceIds) where.push(USER_IMPORTED_ASSET_SQL);
      const params: SqlValue[] = [];
      const add = (sql: string, ...values: SqlValue[]) => {
        where.push(sql);
        params.push(...values);
      };
      if (filter.orientations)
        add(`${ORIENTATION} IN (${marks(filter.orientations.length) || 'NULL'})`, ...filter.orientations);
      if (filter.minQuality !== undefined) add('COALESCE(s.quality, 0) >= ?', filter.minQuality);
      if (filter.minDuration) {
        // Seconds compared without division: value·den / num on both sides, cross-multiplied.
        const { value, rate } = filter.minDuration;
        add(
          `(a.kind != 'video' OR s.duration_value * s.duration_rate_den * ? >= ? * s.duration_rate_num)`,
          rate.num,
          value * rate.den,
        );
      }
      if (filter.capturedFrom !== undefined) add(`${CAPTURED} >= ?`, filter.capturedFrom);
      if (filter.capturedTo !== undefined) add(`${CAPTURED} <= ?`, filter.capturedTo);
      if (filter.sourceIds)
        add(
          `EXISTS (SELECT 1 FROM library_asset_sources l WHERE l.asset_id = a.id AND l.source_id IN (${marks(filter.sourceIds.length) || 'NULL'}))`,
          ...filter.sourceIds,
        );
      if (filter.assetIds) add(`a.id IN (${marks(filter.assetIds.length) || 'NULL'})`, ...filter.assetIds);
      const exclude = [...(filter.exclude ?? [])];
      if (exclude.length > 0) add(`${KEY} NOT IN (${marks(exclude.length)})`, ...exclude);
      const rows = db.driver
        .prepare(
          `SELECT s.id AS id FROM shots s JOIN assets a ON a.id = s.asset_id
           WHERE ${where.join(' AND ')} ORDER BY ${CAPTURED}, ${KEY} LIMIT ?`,
        )
        .all(...params, clampLimit(limit));
      return ok(build(shotsById(rows.map((row) => String(row.id)))));
    },

    async recent(limit: number, signal?: AbortSignal) {
      if (signal?.aborted) return err(CancelledError());
      const rows = db.driver
        .prepare(
          `SELECT s.id AS id FROM shots s JOIN assets a ON a.id = s.asset_id
           WHERE ${CASTABLE} AND ${USER_IMPORTED_ASSET_SQL} ORDER BY ${CAPTURED} DESC, s.id DESC LIMIT ?`,
        )
        .all(clampLimit(limit));
      const ids = rows.map((row) => String(row.id));
      const vectors = directions(ids);
      return ok(ids.flatMap((id) => vectors.get(id) ?? []));
    },
  };
}
