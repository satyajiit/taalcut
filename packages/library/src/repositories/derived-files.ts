// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Files media derived from an asset (P2-L1): proxies, thumbnails,
 * filmstrips, waveforms, stills. Each is a key under the media cache root,
 * never a path; main's media protocol looks keys up here. A new file of the
 * same kind and variant replaces the old one (a new recipe writes a new key).
 * Media evicts files by key (`media.derivedEvicted`), and the rows go too.
 */
import {
  derivedFileRefSchema,
  err,
  ok,
  ValidationError,
  type AssetId,
  type DerivedFileRef,
  type DerivedKind,
  type Result,
  type ShotId,
} from '@taalcut/core';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { LibraryDatabase } from '../db/database';
import { derivedFiles } from '../schema/media';
import { attemptWrite, inTransaction } from './shared';

export type DerivedFileRow = typeof derivedFiles.$inferSelect;

export interface DerivedFileRepository {
  /** Merged by kind and variant: a new thumbnail replaces the old one. `shotId` for a shot's own file. */
  put(assetId: AssetId, refs: readonly DerivedFileRef[], options?: { shotId?: ShotId }): Result<number>;
  /** Rows for evicted keys; returns how many existed. */
  removeKeys(keys: readonly string[]): Result<number>;
  /** The asset's files (its own and its shots'), oldest first. */
  forAsset(assetId: AssetId): DerivedFileRef[];
  hasKey(key: string): boolean;
  /** The newest file of a kind for the asset, or for one of its shots. */
  find(assetId: AssetId, kind: DerivedKind, shotId?: ShotId): DerivedFileRef | undefined;
  /** The row behind a key (main's media protocol checks the asset is still in the library). */
  byKey(key: string): DerivedFileRow | undefined;
}

/** The part of a key between the content hash and `.v<recipe>` (e.g. 's3' in `….s3.v1.jpg`): a slot of its kind. */
export function derivedVariant(key: string): string {
  const name = key.split('/').pop() ?? key;
  const parts = name.split('.');
  // <hash>[.<variant>…].v<recipe>.<ext>
  return parts.slice(1, -2).join('.');
}

export function toDerivedRef(row: DerivedFileRow): DerivedFileRef {
  const ref: DerivedFileRef = {
    kind: row.kind,
    key: row.key,
    bytes: row.bytes,
    mimeType: row.mimeType as DerivedFileRef['mimeType'],
    recipe: row.recipe,
    ...(row.width !== null ? { width: row.width } : {}),
    ...(row.height !== null ? { height: row.height } : {}),
    ...(row.durationValue !== null && row.durationRateNum !== null && row.durationRateDen !== null
      ? {
          duration: {
            value: row.durationValue,
            rate: { num: row.durationRateNum, den: row.durationRateDen },
          },
        }
      : {}),
    ...(row.frameRateNum !== null && row.frameRateDen !== null
      ? { frameRate: { num: row.frameRateNum, den: row.frameRateDen } }
      : {}),
  };
  return ref;
}

export function createDerivedFileRepository(db: LibraryDatabase): DerivedFileRepository {
  const { orm } = db;
  return {
    put(assetId, refs, options = {}) {
      const parsed: DerivedFileRef[] = [];
      for (const ref of refs) {
        const checked = derivedFileRefSchema.safeParse(ref);
        if (!checked.success)
          return err(ValidationError({ field: 'derived' }, { detail: checked.error.message }));
        parsed.push(checked.data);
      }
      const shotId = options.shotId ?? null;
      return inTransaction(db, 'derived_file', () => {
        const existing = orm
          .select({ key: derivedFiles.key, kind: derivedFiles.kind })
          .from(derivedFiles)
          .where(
            and(
              eq(derivedFiles.assetId, assetId),
              shotId ? eq(derivedFiles.shotId, shotId) : isNull(derivedFiles.shotId),
            ),
          )
          .all();
        const replaced = existing.filter((row) =>
          parsed.some((ref) => ref.kind === row.kind && derivedVariant(ref.key) === derivedVariant(row.key)),
        );
        if (replaced.length > 0)
          orm
            .delete(derivedFiles)
            .where(
              inArray(
                derivedFiles.key,
                replaced.map((r) => r.key),
              ),
            )
            .run();
        const now = db.clock();
        for (const ref of parsed) {
          const row = {
            key: ref.key,
            assetId,
            shotId,
            kind: ref.kind,
            bytes: ref.bytes,
            mimeType: ref.mimeType,
            width: ref.width ?? null,
            height: ref.height ?? null,
            durationValue: ref.duration?.value ?? null,
            durationRateNum: ref.duration?.rate.num ?? null,
            durationRateDen: ref.duration?.rate.den ?? null,
            frameRateNum: ref.frameRate?.num ?? null,
            frameRateDen: ref.frameRate?.den ?? null,
            recipe: ref.recipe,
            createdAt: now,
          };
          orm
            .insert(derivedFiles)
            .values(row)
            .onConflictDoUpdate({ target: derivedFiles.key, set: row })
            .run();
        }
        return ok(parsed.length);
      });
    },
    removeKeys: (keys) =>
      keys.length === 0
        ? ok(0)
        : attemptWrite(
            db,
            'derived_file',
            () =>
              orm
                .delete(derivedFiles)
                .where(inArray(derivedFiles.key, [...keys]))
                .run().changes,
          ),
    forAsset: (assetId) =>
      orm
        .select()
        .from(derivedFiles)
        .where(eq(derivedFiles.assetId, assetId))
        .orderBy(asc(derivedFiles.createdAt), asc(derivedFiles.key))
        .all()
        .map(toDerivedRef),
    hasKey: (key) =>
      orm.select({ key: derivedFiles.key }).from(derivedFiles).where(eq(derivedFiles.key, key)).get() !==
      undefined,
    find(assetId, kind, shotId) {
      const row = orm
        .select()
        .from(derivedFiles)
        .where(
          and(
            eq(derivedFiles.assetId, assetId),
            eq(derivedFiles.kind, kind),
            shotId ? eq(derivedFiles.shotId, shotId) : isNull(derivedFiles.shotId),
          ),
        )
        .orderBy(asc(derivedFiles.createdAt))
        .all()
        .at(-1);
      return row ? toDerivedRef(row) : undefined;
    },
    byKey: (key) => orm.select().from(derivedFiles).where(eq(derivedFiles.key, key)).get(),
  };
}
