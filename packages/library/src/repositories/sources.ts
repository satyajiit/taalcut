// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * PROVISIONAL repository for Source, per ADR 0001 (decision D4 awaits PO
 * approval): watched folders and phone import sessions. Removing a source
 * deletes its locations; assets left with none are marked detached (kept,
 * hidden) in the same transaction, so undo's rescan re-attaches them.
 */
import {
  err,
  newId,
  ok,
  ValidationError,
  type Result,
  type SourceId,
  type TransferSessionId,
} from '@taalcut/core';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { LibraryDatabase } from '../db/database';
import { Conflict } from '../errors';
import { sources, type ScanState, type SourceKind, type SourceStatus } from '../schema/library';
import { found, inTransaction, touched } from './shared';

export type Source = typeof sources.$inferSelect;

export interface SourceAdd {
  readonly id?: SourceId;
  readonly kind: SourceKind;
  readonly displayName: string;
  /** Absolute. For import sessions, the managed originals root. */
  readonly rootPath: string;
  readonly volumeUuid?: string | null;
  readonly volumeName?: string | null;
  /** Default 'online'. */
  readonly status?: SourceStatus;
  /** Default true: the jobs process watches the folder. */
  readonly watch?: boolean;
  /** A wifi_import source's transfer session (one source per session). */
  readonly transferSessionId?: TransferSessionId | null;
  /** The phone's label for a wifi_import source: plain text. */
  readonly deviceLabel?: string | null;
}

/** What may change on a source after it is added. */
export interface SourceChanges {
  displayName?: string;
  status?: SourceStatus;
  volumeUuid?: string | null;
  volumeName?: string | null;
  watch?: boolean;
  scanState?: ScanState;
  scanCursor?: string | null;
  lastScanAt?: number | null;
  /** A public error while scanState is 'error'. */
  scanError?: unknown;
}

export interface SourceRepository {
  /** Conflict if a watched folder with the same root path and volume already exists. */
  add(input: SourceAdd): Result<Source>;
  get(id: SourceId): Result<Source>;
  /** Oldest first. */
  list(options?: { kinds?: readonly SourceKind[] }): Source[];
  /** The wifi_import source of a transfer session. */
  findByTransferSession(sessionId: TransferSessionId): Source | undefined;
  update(id: SourceId, changes: SourceChanges): Result<Source>;
  /**
   * Deletes the source and its locations; affected assets' availability is re-derived, and assets
   * left with no location are marked detached (kept and hidden; a rescan after undo re-attaches them).
   */
  remove(id: SourceId): Result<void>;
}

export function createSourceRepository(db: LibraryDatabase): SourceRepository {
  const { orm } = db;
  const get = (id: SourceId) =>
    found(orm.select().from(sources).where(eq(sources.id, id)).get(), 'source', id);
  return {
    add(input) {
      if (!input.displayName.trim()) return err(ValidationError({ field: 'displayName' }));
      if (!input.rootPath.startsWith('/')) return err(ValidationError({ field: 'rootPath' }));
      return inTransaction(db, 'source', () => {
        if (input.kind === 'watched_folder') {
          const same = orm
            .select({ id: sources.id, volumeUuid: sources.volumeUuid })
            .from(sources)
            .where(and(eq(sources.kind, 'watched_folder'), eq(sources.rootPath, input.rootPath)))
            .all()
            .find((s) => s.volumeUuid === (input.volumeUuid ?? null));
          if (same)
            return err(
              Conflict(
                { entity: 'source', name: input.displayName },
                { detail: `already watched as ${same.id}` },
              ),
            );
        }
        const now = db.clock();
        const row: typeof sources.$inferInsert = {
          id: input.id ?? newId<'Source'>(),
          kind: input.kind,
          displayName: input.displayName.trim(),
          rootPath: input.rootPath,
          volumeUuid: input.volumeUuid ?? null,
          volumeName: input.volumeName ?? null,
          status: input.status ?? 'online',
          createdAt: now,
          updatedAt: now,
          watch: input.watch ?? true,
          transferSessionId: input.transferSessionId ?? null,
          deviceLabel: input.deviceLabel?.normalize('NFC') ?? null,
        };
        return ok(orm.insert(sources).values(row).returning().get());
      });
    },
    get,
    list: (options = {}) =>
      orm
        .select()
        .from(sources)
        .where(options.kinds ? inArray(sources.kind, [...options.kinds]) : undefined)
        .orderBy(asc(sources.createdAt), asc(sources.id))
        .all(),
    findByTransferSession: (sessionId) =>
      orm.select().from(sources).where(eq(sources.transferSessionId, sessionId)).get(),
    update(id, changes) {
      if (changes.displayName !== undefined && !changes.displayName.trim()) {
        return err(ValidationError({ field: 'displayName' }));
      }
      return inTransaction(db, 'source', () =>
        found(
          orm
            .update(sources)
            .set({
              ...changes,
              ...(changes.displayName !== undefined ? { displayName: changes.displayName.trim() } : {}),
              updatedAt: db.clock(),
            })
            .where(eq(sources.id, id))
            .returning()
            .get(),
          'source',
          id,
        ),
      );
    },
    remove: (id) =>
      inTransaction(db, 'source', () => {
        const removed = touched(orm.delete(sources).where(eq(sources.id, id)).run().changes, 'source', id);
        if (!removed.ok) return removed;
        markDetached(db);
        return removed;
      }),
  };
}

/**
 * The source of `kind` the library keeps its own files under at `root` (stock downloads, generated files), made
 * on first use: online, and not watched (the library writes there itself). The oldest if there are several.
 */
export function managedSource(
  db: LibraryDatabase,
  kind: Extract<SourceKind, 'stock_import' | 'generated'>,
  displayName: string,
  root: string,
): Result<SourceId> {
  const existing = db.orm
    .select({ id: sources.id })
    .from(sources)
    .where(and(eq(sources.kind, kind), eq(sources.rootPath, root)))
    .orderBy(asc(sources.createdAt), asc(sources.id))
    .limit(1)
    .get();
  if (existing) return ok(existing.id);
  const added = createSourceRepository(db).add({
    kind,
    displayName,
    rootPath: root,
    watch: false,
    status: 'online',
  });
  return added.ok ? ok(added.value.id) : added;
}

/** Assets with no location left are detached from now (`library.collect` deletes them after 30 days). */
export function markDetached(db: LibraryDatabase): number {
  return db.driver
    .prepare(
      `UPDATE assets SET detached_at = ? WHERE detached_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM asset_locations WHERE asset_id = assets.id)`,
    )
    .run(db.clock()).changes;
}
