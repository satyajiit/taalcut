// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Core's HubIndexCache (P3-B12) over migration 21: the hub index and the ratings as last fetched, one row each,
 * replaced on every write. The body is kept as fetched; @taalcut/templates validates it on read, so a body an
 * older or newer client wrote is its call, not the store's.
 */
import {
  err,
  ok,
  ValidationError,
  type AsyncResult,
  type HubCachedDocument,
  type HubIndexCache,
  type Result,
} from '@taalcut/core';
import { eq } from 'drizzle-orm';
import type { LibraryDatabase } from '../db/database';
import { attemptWrite } from '../repositories/shared';
import { hubIndexCache, hubRatingsCache } from '../schema/hub';

type CacheTable = typeof hubIndexCache | typeof hubRatingsCache;

const ROW = 1;

function read(db: LibraryDatabase, table: CacheTable): Result<HubCachedDocument | null> {
  const row = db.orm.select().from(table).where(eq(table.id, ROW)).get();
  if (!row) return ok(null);
  let body: unknown;
  try {
    body = JSON.parse(row.body);
  } catch {
    // The CHECK keeps the text valid JSON; a row that isn't was written around the store.
    return err(ValidationError({ field: 'body' }, { detail: `${tableName(table)} holds no JSON` }));
  }
  return ok({ etag: row.etag, fetchedAt: row.fetchedAt, body });
}

function write(db: LibraryDatabase, table: CacheTable, document: HubCachedDocument): Result<void> {
  if (!Number.isSafeInteger(document.fetchedAt) || document.fetchedAt < 0)
    return err(ValidationError({ field: 'fetchedAt' }));
  if (document.etag !== null && (document.etag.length === 0 || document.etag.length > 512))
    return err(ValidationError({ field: 'etag' }));
  let body: string | undefined;
  try {
    body = JSON.stringify(document.body);
  } catch (cause) {
    return err(
      ValidationError({ field: 'body' }, { detail: cause instanceof Error ? cause.message : 'not JSON' }),
    );
  }
  const values = { id: ROW, etag: document.etag, fetchedAt: document.fetchedAt, body: body ?? 'null' };
  const written = attemptWrite(db, tableName(table), () =>
    db.orm
      .insert(table)
      .values(values)
      .onConflictDoUpdate({
        target: table.id,
        set: { etag: values.etag, fetchedAt: values.fetchedAt, body: values.body },
      })
      .run(),
  );
  return written.ok ? ok(undefined) : written;
}

const tableName = (table: CacheTable) => (table === hubIndexCache ? 'hub_index_cache' : 'hub_ratings_cache');

export function createHubIndexCache(db: LibraryDatabase): HubIndexCache {
  return {
    readIndex: async (): AsyncResult<HubCachedDocument | null> => read(db, hubIndexCache),
    writeIndex: async (document) => write(db, hubIndexCache, document),
    readRatings: async (): AsyncResult<HubCachedDocument | null> => read(db, hubRatingsCache),
    writeRatings: async (document) => write(db, hubRatingsCache, document),
  };
}
