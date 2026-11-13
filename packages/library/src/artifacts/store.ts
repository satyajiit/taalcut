// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Core's ArtifactStore on disk (createLibraryPorts: `artifacts`). Bytes are
 * content-addressed files, `<dir>/<first 2 hex>/<sha-256>`, shared by every
 * artifact with the same content; metadata is the `artifacts` table.
 *
 * - Redacted: the summary always; the bytes when the media type is text
 *   (text/*, JSON, XML, NDJSON) and they decode as UTF-8. Binary is stored as is.
 * - Caps: one artifact at most `maxArtifactBytes` (`library.artifact_too_large`);
 *   all files together at most `maxTotalBytes`, kept by evicting the least
 *   recently used artifacts (a get counts as use) after each put.
 * - Retention: artifacts unused for `maxAgeMs` are removed by the next put or
 *   prune(); prune() also deletes files no row refers to (a crash mid-put).
 *
 * Every decision about which files exist runs synchronously next to the SQL
 * it depends on, so a put and a prune in flight can't delete a file a row
 * still names.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { open, readFile, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  err,
  isId,
  newId,
  NotFoundError,
  ok,
  ValidationError,
  type ArtifactId,
  type ArtifactInput,
  type ArtifactRef,
  type ArtifactStore,
  type AsyncResult,
  type Result,
  type StoredArtifact,
} from '@taalcut/core';
import { asc, eq, inArray, lt } from 'drizzle-orm';
import type { LibraryDatabase } from '../db/database';
import { ArtifactsUnavailable, ArtifactTooLarge } from '../errors';
import { attemptWrite, inTransaction } from '../repositories/shared';
import { artifacts } from '../schema/artifacts';
import { redactText } from '../secrets/redact';

export interface ArtifactStoreOptions {
  /** Default `<database folder>/artifacts`. Required for an in-memory database (else puts fail). */
  readonly dir?: string;
  /** Default 64 MiB. */
  readonly maxArtifactBytes?: number;
  /** Default 1 GiB, counting each file once. */
  readonly maxTotalBytes?: number;
  /** Default 30 days since last use. */
  readonly maxAgeMs?: number;
}

export interface LibraryArtifactStore extends ArtifactStore {
  remove(id: ArtifactId): Result<boolean>;
  /** Applies retention and the size cap, and deletes stray files. Run at start-up; puts do the first two. */
  prune(): Result<{ removed: number }>;
  /** Bytes on disk (each file once) and how many artifacts refer to them. */
  usage(): { bytes: number; artifacts: number };
}

const MiB = 1024 * 1024;
const MAX_SUMMARY = 2000;
const MEDIA_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*(?:\s*;.*)?$/i;
const TEXT_TYPE = /^(?:text\/|application\/(?:[\w.+-]*\+)?(?:json|xml|x-ndjson|ndjson|yaml|x-yaml)\b)/i;
const HASH_FILE = /^[0-9a-f]{64}$/;

type Row = typeof artifacts.$inferSelect;

const refOf = (row: Row): ArtifactRef => ({
  id: row.id,
  mediaType: row.mediaType,
  bytes: row.bytes,
  summary: row.summary,
});

/** Text artifacts are redacted before they are hashed and written; binary passes through. */
function storedBytes(input: ArtifactInput): Uint8Array {
  if (typeof input.data === 'string') return Buffer.from(redactText(input.data), 'utf8');
  if (!TEXT_TYPE.test(input.mediaType)) return input.data;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(input.data);
    const redacted = redactText(text);
    return redacted === text ? input.data : Buffer.from(redacted, 'utf8');
  } catch {
    return input.data; // not UTF-8 after all: stored as bytes
  }
}

const sha256 = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');

export function createArtifactStore(
  db: LibraryDatabase,
  options: ArtifactStoreOptions = {},
): LibraryArtifactStore {
  const { orm } = db;
  const dir = options.dir ?? (db.path === ':memory:' ? null : join(dirname(db.path), 'artifacts'));
  const maxArtifactBytes = options.maxArtifactBytes ?? 64 * MiB;
  const maxTotalBytes = Math.max(options.maxTotalBytes ?? 1024 * MiB, maxArtifactBytes);
  const maxAgeMs = options.maxAgeMs ?? 30 * 24 * 60 * 60 * 1000;

  const fileOf = (hash: string) => join(dir!, hash.slice(0, 2), hash);
  /** Temp files of writes in flight in this process: prune leaves them alone. */
  const writing = new Set<string>();
  const referenced = (hash: string) =>
    orm.select({ id: artifacts.id }).from(artifacts).where(eq(artifacts.contentHash, hash)).limit(1).get() !==
    undefined;

  /** Deletes rows and, in the same synchronous step, the files no row refers to any more. */
  const removeRows = (ids: readonly ArtifactId[]): number => {
    if (ids.length === 0) return 0;
    const gone = inTransaction(db, 'artifact', () =>
      ok(
        orm
          .delete(artifacts)
          .where(inArray(artifacts.id, [...ids]))
          .returning()
          .all(),
      ),
    );
    if (!gone.ok) return 0;
    for (const hash of new Set(gone.value.map((row) => row.contentHash))) {
      if (!referenced(hash)) rmSync(fileOf(hash), { force: true });
    }
    return gone.value.length;
  };

  const totals = () => {
    const rows = orm.select({ hash: artifacts.contentHash, bytes: artifacts.bytes }).from(artifacts).all();
    const files = new Map(rows.map((row) => [row.hash, row.bytes]));
    return { bytes: [...files.values()].reduce((sum, n) => sum + n, 0), artifacts: rows.length };
  };

  /** Removes artifacts past retention, then the least recently used until the files fit the cap. */
  const enforce = (keep?: ArtifactId): number => {
    const stale = orm
      .select({ id: artifacts.id })
      .from(artifacts)
      .where(lt(artifacts.lastUsedAt, db.clock() - maxAgeMs))
      .all()
      .map((row) => row.id)
      .filter((id) => id !== keep);
    let removed = removeRows(stale);
    let { bytes } = totals();
    if (bytes <= maxTotalBytes) return removed;
    const rows = orm.select().from(artifacts).orderBy(asc(artifacts.lastUsedAt), asc(artifacts.id)).all();
    const refs = new Map<string, number>();
    for (const row of rows) refs.set(row.contentHash, (refs.get(row.contentHash) ?? 0) + 1);
    const evict: ArtifactId[] = [];
    for (const row of rows) {
      if (bytes <= maxTotalBytes) break;
      if (row.id === keep) continue;
      evict.push(row.id);
      const left = refs.get(row.contentHash)! - 1;
      refs.set(row.contentHash, left);
      if (left === 0) bytes -= row.bytes;
    }
    removed += removeRows(evict);
    return removed;
  };

  /** Writes the file unless it is there already: to a temp name, fsynced, then renamed into place. */
  const writeFile = async (hash: string, data: Uint8Array): Promise<void> => {
    const path = fileOf(hash);
    if (existsSync(path)) return;
    mkdirSync(dirname(path), { recursive: true });
    const name = `.tmp-${newId<'Artifact'>()}`;
    const temp = join(dir!, name);
    writing.add(name);
    try {
      const handle = await open(temp, 'w');
      try {
        await handle.writeFile(data);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temp, path);
    } catch (cause) {
      await rm(temp, { force: true });
      throw cause;
    } finally {
      writing.delete(name);
    }
  };

  return {
    async put(input): AsyncResult<ArtifactRef> {
      if (!dir) return err(ArtifactsUnavailable(undefined, { detail: 'in-memory database and no folder' }));
      if (!MEDIA_TYPE.test(input.mediaType) || input.mediaType.length > 255) {
        return err(ValidationError({ field: 'mediaType' }));
      }
      const data = storedBytes(input);
      if (data.byteLength > maxArtifactBytes) return err(ArtifactTooLarge({ limit: maxArtifactBytes }));
      const now = db.clock();
      const row: Row = {
        id: newId<'Artifact'>(),
        contentHash: sha256(data),
        mediaType: input.mediaType,
        bytes: data.byteLength,
        summary: redactText(input.summary).slice(0, MAX_SUMMARY),
        createdAt: now,
        lastUsedAt: now,
      };
      // The row first, so a concurrent prune keeps the file; then the file if it isn't there.
      const inserted = attemptWrite(db, 'artifact', () => orm.insert(artifacts).values(row).run());
      if (!inserted.ok) return inserted;
      try {
        await writeFile(row.contentHash, data);
      } catch {
        removeRows([row.id]);
        return err(ArtifactsUnavailable(undefined, { detail: 'could not write the artifact file' }));
      }
      enforce(row.id);
      return ok(refOf(row));
    },

    async get(id): AsyncResult<StoredArtifact> {
      const missing = err(NotFoundError({ entity: 'artifact', id: isId(id) ? id : undefined }));
      if (!isId(id) || !dir) return missing;
      const row = orm.select().from(artifacts).where(eq(artifacts.id, id)).get();
      if (!row) return missing;
      let data: Uint8Array;
      try {
        data = new Uint8Array(await readFile(fileOf(row.contentHash)));
      } catch {
        return err(NotFoundError({ entity: 'artifact', id }, { detail: 'the file is gone' }));
      }
      if (sha256(data) !== row.contentHash) {
        return err(NotFoundError({ entity: 'artifact', id }, { detail: 'the file changed on disk' }));
      }
      // Best effort: a busy database shouldn't fail a read.
      attemptWrite(db, 'artifact', () =>
        orm.update(artifacts).set({ lastUsedAt: db.clock() }).where(eq(artifacts.id, id)).run(),
      );
      return ok({ ref: refOf(row), data });
    },

    remove: (id) => ok(isId(id) && removeRows([id]) > 0),

    prune() {
      const removed = enforce();
      if (dir && existsSync(dir)) {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const path = join(dir, entry.name);
          if (entry.isFile() && entry.name.startsWith('.tmp-') && !writing.has(entry.name)) {
            rmSync(path, { force: true }); // left by a crash mid-write
          }
          if (!entry.isDirectory() || !/^[0-9a-f]{2}$/.test(entry.name)) continue;
          for (const file of readdirSync(path)) {
            if (HASH_FILE.test(file) && !referenced(file)) rmSync(join(path, file), { force: true });
          }
        }
      }
      return ok({ removed });
    },

    usage: totals,
  };
}
