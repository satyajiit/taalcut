// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * PROVISIONAL (decision D4 awaits PO approval). Drizzle tables: Source,
 * Asset, AssetLocation and Shot, exactly as docs/adr/0001-library-storage.md
 * "Phase 1 schema stubs" specifies; created by migration 4. Phone imports are
 * copied into the managed originals root, watched folders are referenced in
 * place, bytes are identified by BLAKE3, volumes by APFS Volume UUID.
 *
 * Media times are RationalTime as two integers (value, rate), never floats.
 * `assets.availability` is derived by triggers from the locations' states.
 */
import {
  DEVICE_BRIDGE_KINDS,
  HDR_KINDS,
  ORIENTATIONS,
  REENCODE_VERDICTS,
  SOURCE_KINDS,
  SPEED_KINDS,
  type AssetId,
  type DeviceImportRunId,
  type ShotId,
  type SourceId,
  type TransferSessionId,
} from '@taalcut/core';
import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import type { AssetLocationId } from '../ids';

export { SOURCE_KINDS };
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const SOURCE_STATUSES = ['online', 'offline', 'missing'] as const;
export type SourceStatus = (typeof SOURCE_STATUSES)[number];

export const SCAN_STATES = ['idle', 'scanning', 'error'] as const;
export type ScanState = (typeof SCAN_STATES)[number];

export const sources = sqliteTable(
  'sources',
  {
    id: text('id').$type<SourceId>().primaryKey(),
    kind: text('kind', { enum: SOURCE_KINDS }).notNull(),
    displayName: text('display_name').notNull(),
    /** The watched root, or the managed originals root for an import session. */
    rootPath: text('root_path').notNull(),
    /** APFS Volume UUID; null only before the volume has been identified. */
    volumeUuid: text('volume_uuid'),
    /** Display only: renaming a volume doesn't change its identity. */
    volumeName: text('volume_name'),
    status: text('status', { enum: SOURCE_STATUSES }).notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    // Migration 12 (P2-L2, P2-L3).
    /** 1: the jobs process watches the folder. */
    watch: integer('watch', { mode: 'boolean' }).notNull().default(true),
    scanState: text('scan_state', { enum: SCAN_STATES }).notNull().default('idle'),
    /** The last relative path a scan finished, so a scan stopped by a quit resumes after it. */
    scanCursor: text('scan_cursor'),
    lastScanAt: integer('last_scan_at'),
    /** A public error (JSON) while `scan_state` is 'error'. */
    scanError: text('scan_error', { mode: 'json' }).$type<unknown>(),
    /** One wifi_import source per transfer session. */
    transferSessionId: text('transfer_session_id').$type<TransferSessionId>(),
    /** e.g. "iPhone", from the phone's browser: plain text. */
    deviceLabel: text('device_label'),
  },
  (t) => [
    uniqueIndex('sources_transfer_session_uq')
      .on(t.transferSessionId)
      .where(sql`${t.transferSessionId} IS NOT NULL`),
  ],
);

export const ASSET_KINDS = ['video', 'image', 'audio', 'live_photo'] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

export const AVAILABILITIES = ['online', 'offline', 'missing', 'icloud_placeholder'] as const;
export type Availability = (typeof AVAILABILITIES)[number];

export const assets = sqliteTable(
  'assets',
  {
    id: text('id').$type<AssetId>().primaryKey(),
    kind: text('kind', { enum: ASSET_KINDS }).notNull(),
    /** 'blake3' once the full hash is known. */
    contentHashAlg: text('content_hash_alg', { enum: ['blake3'] }),
    /** Hex BLAKE3-256; unique with the algorithm where set. */
    contentHash: text('content_hash'),
    /** Hex XXH3-128 of the ADR's sampled layout. A candidate key, not unique. */
    partialHash: text('partial_hash'),
    sizeBytes: integer('size_bytes').notNull(),
    /** Name at first ingest. Not an identity. */
    originalFilename: text('original_filename').notNull(),
    captureTime: integer('capture_time'),
    width: integer('width'),
    height: integer('height'),
    rotationDegrees: integer('rotation_degrees'),
    /** Duration as RationalTime: value units at durationRateNum/durationRateDen (migration 8). */
    durationValue: integer('duration_value'),
    durationRateNum: integer('duration_rate_num'),
    durationRateDen: integer('duration_rate_den'),
    availability: text('availability', { enum: AVAILABILITIES }).notNull(),
    createdAt: integer('created_at').notNull(),
    // Migration 12 (P2-L1): the profile's columns. `facts` is the source; the rest are read from it.
    /** Bumped by a re-index: results for an older generation are dropped. */
    generation: integer('generation').notNull().default(0),
    updatedAt: integer('updated_at').notNull().default(0),
    /** MediaFacts (core), validated on write and read. */
    facts: text('facts', { mode: 'json' }).$type<unknown>(),
    orientation: text('orientation', { enum: ORIENTATIONS }),
    hdr: text('hdr', { enum: HDR_KINDS }),
    speed: text('speed', { enum: SPEED_KINDS }),
    frameRateNum: integer('frame_rate_num'),
    frameRateDen: integer('frame_rate_den'),
    hasAudio: integer('has_audio', { mode: 'boolean' }),
    /** The capture time's UTC offset in minutes, when the device wrote one. */
    captureOffsetMin: integer('capture_offset_min'),
    /** Shown on this Mac only: never in telemetry, debug bundles or model prompts. */
    latitude: real('latitude'),
    longitude: real('longitude'),
    deviceMake: text('device_make'),
    deviceModel: text('device_model'),
    /** Pairs a Live Photo's still and movie. */
    livePhotoId: text('live_photo_id'),
    /** The movie half of a Live Photo points at its still (hidden from browse and search). */
    companionOf: text('companion_of').$type<AssetId>(),
    /** BCP 47, from speech. */
    language: text('language'),
    reencode: text('reencode', { enum: REENCODE_VERDICTS }),
    reencodeReasons: text('reencode_reasons', { mode: 'json' }).$type<string[]>(),
    /** A music file's BeatMap (audio.beats), JSON; null before the stage ran and for anything else. */
    beatMap: text('beat_map', { mode: 'json' }).$type<unknown>(),
    trashedAt: integer('trashed_at'),
    /** When its last location went; null while it has one. `library.collect` deletes after 30 days. */
    detachedAt: integer('detached_at'),
    /** Migration 19. The SQL default is captured; stock and generated imports overwrite it. */
    provenance: text('provenance').notNull().default('{"kind":"captured"}'),
  },
  (t) => [
    index('assets_capture_idx').on(t.captureTime, t.id),
    index('assets_created_idx').on(t.createdAt, t.id),
    index('assets_live_photo_idx')
      .on(t.livePhotoId)
      .where(sql`${t.livePhotoId} IS NOT NULL`),
    index('assets_companion_idx')
      .on(t.companionOf)
      .where(sql`${t.companionOf} IS NOT NULL`),
    index('assets_detached_idx')
      .on(t.detachedAt)
      .where(sql`${t.detachedAt} IS NOT NULL`),
    uniqueIndex('assets_content_hash_uq')
      .on(t.contentHashAlg, t.contentHash)
      .where(sql`${t.contentHash} IS NOT NULL`),
    index('assets_partial_hash_idx')
      .on(t.partialHash)
      .where(sql`${t.partialHash} IS NOT NULL`),
  ],
);

export const ASSET_STORAGE = ['managed', 'referenced'] as const;
export type AssetStorage = (typeof ASSET_STORAGE)[number];

export const LOCATION_STATES = ['present', 'offline', 'missing', 'icloud_placeholder'] as const;
export type LocationState = (typeof LOCATION_STATES)[number];

/** How a location was found (migration 12). */
export const LOCATION_VIAS = [
  'scan',
  'watcher',
  'wifi',
  'usb',
  'relink',
  'local',
  'camera',
  'photos',
] as const;
export type LocationVia = (typeof LOCATION_VIAS)[number];

export const assetLocations = sqliteTable(
  'asset_locations',
  {
    id: text('id').$type<AssetLocationId>().primaryKey(),
    assetId: text('asset_id')
      .$type<AssetId>()
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    sourceId: text('source_id')
      .$type<SourceId>()
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    /** At most one `managed` location per asset. */
    storage: text('storage', { enum: ASSET_STORAGE }).notNull(),
    /** Relative to the source's root_path. */
    relativePath: text('relative_path').notNull(),
    /** Rebuilt from the mount point. Not identity. */
    absolutePathCached: text('absolute_path_cached'),
    /** Volume that held the file at the last scan. */
    volumeUuid: text('volume_uuid'),
    partialHash: text('partial_hash'),
    fullHash: text('full_hash'),
    sizeBytes: integer('size_bytes').notNull(),
    /** A change schedules a rehash; it doesn't change the asset hash by itself. */
    mtimeMs: integer('mtime_ms'),
    state: text('state', { enum: LOCATION_STATES }).notNull(),
    // Migration 12 (P2-L2).
    /** Inode: narrows move candidates, never decides alone. */
    fileId: integer('file_id'),
    firstSeenAt: integer('first_seen_at'),
    lastSeenAt: integer('last_seen_at'),
    missingSince: integer('missing_since'),
    via: text('via', { enum: LOCATION_VIAS }),
  },
  (t) => [
    index('asset_locations_missing_idx')
      .on(t.sizeBytes)
      .where(sql`${t.state} = 'missing'`),
    index('asset_locations_file_idx')
      .on(t.fileId)
      .where(sql`${t.fileId} IS NOT NULL`),
    uniqueIndex('asset_locations_path_uq').on(t.assetId, t.sourceId, t.relativePath),
    uniqueIndex('asset_locations_one_managed_uq')
      .on(t.assetId)
      .where(sql`${t.storage} = 'managed'`),
    index('asset_locations_source_idx').on(t.sourceId, t.relativePath),
    index('asset_locations_volume_idx')
      .on(t.volumeUuid)
      .where(sql`${t.volumeUuid} IS NOT NULL`),
    index('asset_locations_partial_hash_idx')
      .on(t.partialHash)
      .where(sql`${t.partialHash} IS NOT NULL`),
  ],
);

export const shots = sqliteTable(
  'shots',
  {
    id: text('id').$type<ShotId>().primaryKey(),
    assetId: text('asset_id')
      .$type<AssetId>()
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    indexInAsset: integer('index_in_asset').notNull(),
    /** Start and duration as RationalTime: value units at rateNum/rateDen (migration 8). */
    startValue: integer('start_value').notNull(),
    startRateNum: integer('start_rate_num').notNull(),
    startRateDen: integer('start_rate_den').notNull(),
    durationValue: integer('duration_value').notNull(),
    durationRateNum: integer('duration_rate_num').notNull(),
    durationRateDen: integer('duration_rate_den').notNull(),
    // Migration 12 (P2-L1): the ShotAnalysis and the columns search, filters and casting read from it.
    /** ShotAnalysis (core), validated on write and read; null until vision analysed the shot. */
    analysis: text('analysis', { mode: 'json' }).$type<unknown>(),
    /** The model's description: plain text. */
    description: text('description'),
    /** The description's objects, joined by U+001F. */
    objects: text('objects'),
    place: text('place'),
    shotType: text('shot_type'),
    motion: text('motion'),
    energy: real('energy'),
    /** quality.overall. */
    quality: real('quality'),
    /** The on-screen text tracks, joined by newlines. */
    onScreenText: text('on_screen_text'),
    bestFrame: integer('best_frame'),
    dHash: text('d_hash'),
    /** The speech inside the shot's range: plain text. */
    transcriptText: text('transcript_text'),
    /** The near-duplicate group's leader (a ShotId); cleared by a trigger when it goes. */
    duplicateGroup: text('duplicate_group').$type<ShotId>(),
    bestTake: integer('best_take', { mode: 'boolean' }).notNull().default(true),
    generation: integer('generation').notNull().default(0),
    createdAt: integer('created_at').notNull().default(0),
  },
  (t) => [
    uniqueIndex('shots_asset_index_uq').on(t.assetId, t.indexInAsset),
    index('shots_duplicate_group_idx')
      .on(t.duplicateGroup)
      .where(sql`${t.duplicateGroup} IS NOT NULL`),
  ],
);

/** One licence row per stock (or bundled) asset. nc_excluded is always 1: NC never lands here. */
export const LICENCE_SOURCES = ['pexels', 'freesound', 'bundled'] as const;

export const assetLicences = sqliteTable(
  'asset_licences',
  {
    assetId: text('asset_id')
      .$type<AssetId>()
      .primaryKey()
      .references(() => assets.id, { onDelete: 'cascade' }),
    source: text('source', { enum: LICENCE_SOURCES }).notNull(),
    providerAssetId: text('provider_asset_id').notNull(),
    licence: text('licence').notNull(),
    rawLicence: text('raw_licence').notNull(),
    ncExcluded: integer('nc_excluded').notNull(),
    author: text('author'),
    authorUrl: text('author_url'),
    sourceUrl: text('source_url'),
    attribution: text('attribution').notNull(),
    fetchedAt: integer('fetched_at').notNull(),
  },
  (t) => [uniqueIndex('asset_licences_provider_uq').on(t.source, t.providerAssetId)],
);

/** Cached stock search bodies and import→asset links (`import:` keys do not expire). */
export const stockSearchCache = sqliteTable('stock_search_cache', {
  key: text('key').primaryKey(),
  provider: text('provider').notNull(),
  body: text('body').notNull(),
  fetchedAt: integer('fetched_at').notNull(),
});

/** Migration 23 (P3-B4, P3-B5): the import record of a USB item, one row per device item. */
export const usbImports = sqliteTable(
  'usb_imports',
  {
    deviceKey: text('device_key').notNull(),
    itemKey: text('item_key').notNull(),
    assetId: text('asset_id')
      .$type<AssetId>()
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    runId: text('run_id').$type<DeviceImportRunId>().notNull(),
    bridge: text('bridge', { enum: DEVICE_BRIDGE_KINDS }).notNull(),
    /** The device's creation date for the item, when it gave one. */
    deviceCreatedAt: integer('device_created_at'),
    album: text('album'),
    /** SHA-256 of the staged bytes, and of the same bytes on the device when the bridge can say. */
    sha256: text('sha256').notNull(),
    sourceSha256: text('source_sha256'),
    importedAt: integer('imported_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.deviceKey, t.itemKey] }), index('usb_imports_asset_idx').on(t.assetId)],
);
