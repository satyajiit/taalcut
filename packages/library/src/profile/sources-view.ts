// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Sources as Settings → Sources and the sourcePicker card show them (core's
 * SourceView), and the library's storage (core's LibraryStorage): the
 * originals root's volume and space, and the catalogue's size.
 */
import { statfs, stat } from 'node:fs/promises';
import {
  ok,
  publicErrorSchema,
  type AsyncResult,
  type LibraryStorage,
  type SourceId,
  type SourceView,
} from '@taalcut/core';
import type { LibraryDatabase } from '../db/database';
import { createSourceRepository } from '../repositories/sources';
import { USER_IMPORTED_ASSET_SQL } from './filters';

/** Every user-facing source, oldest first, with its asset and missing-file counts and scan state. */
export function sourceViews(db: LibraryDatabase): SourceView[] {
  const counts = new Map(
    (
      db.driver
        .prepare(
          `SELECT l.source_id AS id, COUNT(DISTINCT l.asset_id) AS assets,
             SUM(l.state = 'missing') AS missing
           FROM library_asset_sources l JOIN assets a ON a.id = l.asset_id
           WHERE a.trashed_at IS NULL AND a.companion_of IS NULL AND ${USER_IMPORTED_ASSET_SQL}
           GROUP BY l.source_id`,
        )
        .all() as { id: SourceId; assets: number; missing: number }[]
    ).map((r) => [r.id, r]),
  );
  return createSourceRepository(db)
    .list()
    .filter((source) => source.kind !== 'generated' && source.kind !== 'bundled')
    .map((source) => {
      const error = source.scanError == null ? undefined : publicErrorSchema.safeParse(source.scanError);
      return {
        id: source.id,
        kind: source.kind,
        name: source.displayName,
        status: source.status,
        path: source.kind === 'watched_folder' ? source.rootPath : null,
        watch: source.watch,
        scan: {
          state: source.scanState,
          lastScanAt: source.lastScanAt,
          ...(error?.success ? { error: error.data } : {}),
        },
        assets: counts.get(source.id)?.assets ?? 0,
        missing: counts.get(source.id)?.missing ?? 0,
        createdAt: source.createdAt,
      };
    });
}

export interface StorageOptions {
  /** The managed originals root (Wi-Fi and USB imports land here). */
  readonly originalsRoot: string;
  /** The root's volume name, when the caller knows it (a volume probe). */
  readonly volumeName?: string | null;
}

/** Bytes of the database file and its WAL (0 for an in-memory database). */
async function catalogBytes(db: LibraryDatabase): Promise<number> {
  const path = db.driver.path;
  if (path === ':memory:' || path === '') return 0;
  const sizes = await Promise.all(
    [path, `${path}-wal`].map((file) =>
      stat(file)
        .then((s) => s.size)
        .catch(() => 0),
    ),
  );
  return sizes.reduce((sum, size) => sum + size, 0);
}

export async function libraryStorage(
  db: LibraryDatabase,
  options: StorageOptions,
): AsyncResult<LibraryStorage> {
  const used = db.driver
    .prepare(`SELECT coalesce(SUM(size_bytes), 0) AS bytes FROM asset_locations WHERE storage = 'managed'`)
    .get();
  const space = await statfs(options.originalsRoot).catch(() => undefined);
  return ok({
    originalsRoot: {
      path: options.originalsRoot,
      volumeName: options.volumeName ?? null,
      online: space !== undefined,
      freeBytes: space ? Math.max(0, Math.floor(Number(space.bavail) * Number(space.bsize))) : null,
      usedBytes: Number(used?.bytes ?? 0),
    },
    catalogBytes: await catalogBytes(db),
  });
}
