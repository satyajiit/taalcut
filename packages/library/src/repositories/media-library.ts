// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * PROVISIONAL repository for Asset, per ADR 0001 (decision D4
 * awaits PO approval). Sources are in sources.ts; locations and shots in asset-locations.ts.
 * An asset's availability is never written here: triggers derive it from its
 * locations in the same transaction.
 */
import { err, newId, ok, ValidationError, type AssetId, type Result } from '@taalcut/core';
import { and, asc, eq, gt, inArray, isNotNull, isNull } from 'drizzle-orm';
import type { LibraryDatabase } from '../db/database';
import { assets, type AssetKind, type Availability } from '../schema/library';
import { attemptWrite, found, inTransaction, pageSize, touched } from './shared';
import { normaliseTime, type StoredTime } from './stored-time';
import { createAssetFactsMethods, type AssetFactsMethods } from './asset-facts';

export type Asset = typeof assets.$inferSelect;

export interface AssetCreate {
  readonly id?: AssetId;
  readonly kind: AssetKind;
  readonly sizeBytes: number;
  readonly originalFilename: string;
  /** Hex BLAKE3-256, when already known. */
  readonly contentHash?: string | null;
  /** Hex XXH3-128 of the ADR's sampled layout. */
  readonly partialHash?: string | null;
  readonly captureTime?: number | null;
  readonly width?: number | null;
  readonly height?: number | null;
  readonly rotationDegrees?: 0 | 90 | 180 | 270 | null;
  readonly duration?: StoredTime | null;
}

export type AssetProbe = Pick<
  AssetCreate,
  'captureTime' | 'width' | 'height' | 'rotationDegrees' | 'duration'
>;

export interface AssetRepository extends AssetFactsMethods {
  /** Availability starts 'missing' and follows the locations added later. Conflict if the BLAKE3 is taken. */
  create(input: AssetCreate): Result<Asset>;
  get(id: AssetId): Result<Asset>;
  /** The asset with these bytes (the BLAKE3 is the unique key). */
  findByContentHash(contentHash: string): Asset | undefined;
  /** Candidates only: the partial hash is not unique. */
  findByPartialHash(partialHash: string): Asset[];
  /** Fills the BLAKE3 after a background hash. Conflict if another asset has it (a duplicate to merge). */
  setContentHash(id: AssetId, contentHash: string): Result<Asset>;
  /** Fills probe columns (P2-L4). Fields left undefined are unchanged. */
  updateProbe(id: AssetId, probe: AssetProbe): Result<Asset>;
  list(options?: { availability?: Availability; afterId?: AssetId; limit?: number }): Asset[];
  remove(id: AssetId): Result<void>;
  /** Moves assets to the trash (hidden from browse and search). Returns how many were not already there. */
  trash(ids: readonly AssetId[]): Result<number>;
  /** Takes assets out of the trash. Returns how many were in it. */
  restore(ids: readonly AssetId[]): Result<number>;
}

const BLAKE3_HEX = /^[0-9a-f]{64}$/;
const XXH3_128_HEX = /^[0-9a-f]{32}$/;

function checkHash(field: string, value: string | null | undefined, pattern: RegExp): Result<void> {
  return value == null || pattern.test(value) ? ok(undefined) : err(ValidationError({ field }));
}

function checkProbe(probe: AssetProbe): Result<void> {
  const positive = (v: number | null | undefined) => v == null || (Number.isSafeInteger(v) && v > 0);
  if (!positive(probe.width)) return err(ValidationError({ field: 'width' }));
  if (!positive(probe.height)) return err(ValidationError({ field: 'height' }));
  if (probe.duration && !normaliseTime(probe.duration)) {
    return err(
      ValidationError(
        { field: 'duration' },
        { detail: 'RationalTime needs an integer value and rate num/den > 0' },
      ),
    );
  }
  return ok(undefined);
}

/** Insert values: every probe column, null when unknown. */
function probeValues(probe: AssetProbe) {
  return {
    captureTime: probe.captureTime ?? null,
    width: probe.width ?? null,
    height: probe.height ?? null,
    rotationDegrees: probe.rotationDegrees ?? null,
    ...durationColumns(probe.duration ?? null),
  };
}

/** Update values: only the probe columns the caller passed. */
function probeColumns(probe: AssetProbe): Partial<Asset> {
  const set: Partial<Asset> = {};
  if (probe.captureTime !== undefined) set.captureTime = probe.captureTime;
  if (probe.width !== undefined) set.width = probe.width;
  if (probe.height !== undefined) set.height = probe.height;
  if (probe.rotationDegrees !== undefined) set.rotationDegrees = probe.rotationDegrees;
  if (probe.duration !== undefined) Object.assign(set, durationColumns(probe.duration));
  return set;
}

/** The duration columns, the rate reduced; checkProbe has validated it. */
function durationColumns(duration: StoredTime | null) {
  const time = duration && normaliseTime(duration);
  return {
    durationValue: time?.value ?? null,
    durationRateNum: time?.rate.num ?? null,
    durationRateDen: time?.rate.den ?? null,
  };
}

export function createAssetRepository(db: LibraryDatabase): AssetRepository {
  const { orm } = db;
  const get = (id: AssetId) => found(orm.select().from(assets).where(eq(assets.id, id)).get(), 'asset', id);
  const findByContentHash = (contentHash: string) =>
    orm
      .select()
      .from(assets)
      .where(and(eq(assets.contentHashAlg, 'blake3'), eq(assets.contentHash, contentHash)))
      .get();
  return {
    ...createAssetFactsMethods(db),
    create(input) {
      if (!input.originalFilename) return err(ValidationError({ field: 'originalFilename' }));
      if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 0) {
        return err(ValidationError({ field: 'sizeBytes' }));
      }
      const checks = [
        checkHash('contentHash', input.contentHash, BLAKE3_HEX),
        checkHash('partialHash', input.partialHash, XXH3_128_HEX),
        checkProbe(input),
      ];
      const failed = checks.find((c) => !c.ok);
      if (failed) return failed as Result<never>;
      const now = db.clock();
      const row = {
        id: input.id ?? newId<'Asset'>(),
        kind: input.kind,
        contentHashAlg: input.contentHash ? ('blake3' as const) : null,
        contentHash: input.contentHash ?? null,
        partialHash: input.partialHash ?? null,
        sizeBytes: input.sizeBytes,
        originalFilename: input.originalFilename,
        availability: 'missing' as const,
        createdAt: now,
        updatedAt: now,
        ...probeValues(input),
      };
      return attemptWrite(db, 'asset', () => orm.insert(assets).values(row).returning().get());
    },
    get,
    findByContentHash,
    findByPartialHash: (partialHash) =>
      orm.select().from(assets).where(eq(assets.partialHash, partialHash)).orderBy(asc(assets.id)).all(),
    setContentHash(id, contentHash) {
      const valid = checkHash('contentHash', contentHash, BLAKE3_HEX);
      if (!valid.ok) return valid;
      return inTransaction(db, 'asset', () =>
        found(
          orm
            .update(assets)
            .set({ contentHashAlg: 'blake3', contentHash })
            .where(eq(assets.id, id))
            .returning()
            .get(),
          'asset',
          id,
        ),
      );
    },
    updateProbe(id, probe) {
      const valid = checkProbe(probe);
      if (!valid.ok) return valid;
      const set = probeColumns(probe);
      if (Object.keys(set).length === 0) return get(id);
      return inTransaction(db, 'asset', () =>
        found(orm.update(assets).set(set).where(eq(assets.id, id)).returning().get(), 'asset', id),
      );
    },
    list: (options = {}) =>
      orm
        .select()
        .from(assets)
        .where(
          and(
            options.availability ? eq(assets.availability, options.availability) : undefined,
            options.afterId ? gt(assets.id, options.afterId) : undefined,
          ),
        )
        .orderBy(asc(assets.id))
        .limit(pageSize(options.limit, 500, 5000))
        .all(),
    remove: (id) =>
      inTransaction(db, 'asset', () =>
        touched(orm.delete(assets).where(eq(assets.id, id)).run().changes, 'asset', id),
      ),
    trash: (ids) =>
      attemptWrite(db, 'asset', () => {
        const now = db.clock();
        return orm
          .update(assets)
          .set({ trashedAt: now, updatedAt: now })
          .where(and(inArray(assets.id, [...ids]), isNull(assets.trashedAt)))
          .run().changes;
      }),
    restore: (ids) =>
      attemptWrite(
        db,
        'asset',
        () =>
          orm
            .update(assets)
            .set({ trashedAt: null, updatedAt: db.clock() })
            .where(and(inArray(assets.id, [...ids]), isNotNull(assets.trashedAt)))
            .run().changes,
      ),
  };
}
