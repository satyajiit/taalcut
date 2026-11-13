// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A store of content-addressed asset files, `<dir>/<2 hex>/<sha256>`, each with a row in its own table that says
 * the file is the store's. The file is written durably before its row, so a row always has its file. `prune`
 * deletes the rows nothing has used for a while, then any file with no row (left by a crash between the file and
 * its row). Template contact sheets and Style logos are two of these; each kind brings its table, what it
 * accepts, what a put of bytes already there changes, and what "no longer used" means.
 */
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { err, NotFoundError, ok, ValidationError, type AsyncResult, type Result } from '@taalcut/core';
import { eq, type SQL } from 'drizzle-orm';
import type { AnySQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core';
import type { LibraryDatabase } from '../db/database';
import { writeDurably } from '../files/durable-files';
import { attemptWrite } from '../repositories/shared';
import { sha256Hex } from './canonical';

const SHA256 = /^[0-9a-f]{64}$/;

export function contentAssetPath(dir: string, sha256: string): string {
  return join(dir, sha256.slice(0, 2), sha256);
}

interface ContentAssetRow<M extends string> {
  readonly sha256: string;
  readonly mediaType: M;
  readonly bytes: number;
  readonly createdAt: number;
}

/** One kind of content-addressed asset. */
interface ContentAssetKind<M extends string> {
  /** The entity its errors name ('template_asset'). */
  readonly entity: string;
  readonly table: SQLiteTable;
  /** The table's primary key. */
  readonly sha256: AnySQLiteColumn<{ data: string; notNull: true }>;
  readonly mediaTypes: readonly M[];
  readonly maxBytes: number;
  /** How long an asset nothing uses is kept by default. */
  readonly keepUnusedMs: number;
  /** Writes a put's row; decides what a put of bytes already stored changes. */
  insert(row: ContentAssetRow<M>): void;
  /** The rows nothing uses, unused since before `cutoff`: what `prune` deletes. */
  unused(cutoff: number): SQL | undefined;
}

export function createContentAssets<M extends string>(
  db: LibraryDatabase,
  dir: string,
  kind: ContentAssetKind<M>,
) {
  const { orm } = db;
  return {
    async put(bytes: Uint8Array, mediaType: M): AsyncResult<{ sha256: string; bytes: number }> {
      if (!kind.mediaTypes.includes(mediaType)) return err(ValidationError({ field: 'mediaType' }));
      if (bytes.length === 0 || bytes.length > kind.maxBytes)
        return err(ValidationError({ field: 'bytes' }, { detail: `${bytes.length} bytes` }));
      const sha256 = sha256Hex(bytes);
      const path = contentAssetPath(dir, sha256);
      // The file first, then the row: a row always has its file.
      if (!existsSync(path)) {
        await mkdir(dirname(path), { recursive: true });
        await writeDurably(path, bytes);
      }
      const row = { sha256, mediaType, bytes: bytes.length, createdAt: db.clock() };
      const saved = attemptWrite(db, kind.entity, () => kind.insert(row));
      return saved.ok ? ok({ sha256, bytes: bytes.length }) : saved;
    },

    path(sha256: string): Result<string> {
      if (!SHA256.test(sha256)) return err(ValidationError({ field: 'sha256' }));
      const row = orm.select({ sha256: kind.sha256 }).from(kind.table).where(eq(kind.sha256, sha256)).get();
      const path = contentAssetPath(dir, sha256);
      if (!row || !existsSync(path)) return err(NotFoundError({ entity: kind.entity, id: sha256 }));
      return ok(path);
    },

    /**
     * Deletes the assets nothing has used for `olderThanMs`, then files with no row (left by a removed owner or a
     * crash between the file and its row). Returns how many rows went.
     */
    prune(olderThanMs = kind.keepUnusedMs): Result<number> {
      const cutoff = db.clock() - olderThanMs;
      const removed = attemptWrite(
        db,
        kind.entity,
        () => orm.delete(kind.table).where(kind.unused(cutoff)).run().changes,
      );
      if (!removed.ok) return removed;
      const known = orm.select({ sha256: kind.sha256 }).from(kind.table).all();
      sweepUnknownFiles(dir, new Set(known.map((row) => row.sha256)));
      return removed;
    },
  };
}

/** A file younger than this may belong to a put whose row isn't committed yet. */
const SWEEP_GRACE_MS = 60_000;

/** Deletes files (and temp files) under a content-addressed `dir` whose sha256 is not in `known`. */
function sweepUnknownFiles(dir: string, known: ReadonlySet<string>): void {
  if (!existsSync(dir)) return;
  for (const bucket of readdirSync(dir)) {
    if (!/^[0-9a-f]{2}$/.test(bucket)) continue;
    for (const name of readdirSync(join(dir, bucket))) {
      const path = join(dir, bucket, name);
      if (known.has(name)) continue;
      const modified = statSync(path, { throwIfNoEntry: false })?.mtimeMs ?? 0;
      if (Date.now() - modified > SWEEP_GRACE_MS) rmSync(path, { force: true });
    }
  }
}
