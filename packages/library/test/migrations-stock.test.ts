// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Migration 19 (stock and provenance, P3-V18) with data: rebuilding `sources`
 * keeps every source and the locations that point at it, a render's batch id
 * is copied out of its request, the licence row's checks hold, running it
 * again is a no-op, and down refuses while a stock source exists (the old
 * CHECK cannot hold it), then goes down and up again once it is gone.
 */
import { newId, unwrap } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createAssetLocationRepository, createSourceRepository, type LibraryDatabase } from '../src/index';
import { openTestDb } from './helpers';

const sql = (db: LibraryDatabase, text: string, ...params: (string | number | null)[]) =>
  db.driver.prepare(text).run(...params);
const get = (db: LibraryDatabase, text: string, ...params: (string | number)[]) =>
  db.driver.prepare(text).get(...params);

function seedRender(db: LibraryDatabase, projectId: string, request: object): string {
  const id = newId<'Render'>();
  sql(
    db,
    `INSERT INTO renders (id, project_id, timeline_id, timeline_revision, preset_id, status, name, width, height,
       rate_num, rate_den, duration_frames, music, captions, notify, request, request_key, created_at)
     VALUES (?, ?, 't', 1, 'reels', 'ready', 'Cut', 1080, 1920, 30, 1, 90, 'none', '{}', 0, ?, ?, 1)`,
    id,
    projectId,
    JSON.stringify(request),
    id,
  );
  return id;
}

function licenceRow(db: LibraryDatabase, assetId: string, providerId: string, ncExcluded: number) {
  sql(
    db,
    `INSERT INTO asset_licences (asset_id, source, provider_asset_id, licence, raw_licence, nc_excluded,
       attribution, fetched_at) VALUES (?, 'pexels', ?, 'Pexels-Licence', 'Pexels-Licence', ?, '', 1)`,
    assetId,
    providerId,
    ncExcluded,
  );
}

describe('migration 19: stock and provenance', () => {
  it('keeps sources and their locations, backfills batch ids and holds the licence checks', () => {
    const db = openTestDb({ targetVersion: 18 });
    const source = unwrap(
      createSourceRepository(db).add({ kind: 'wifi_import', displayName: 'Phone', rootPath: '/Users/me/In' }),
    );
    const assetId = newId<'Asset'>();
    sql(
      db,
      `INSERT INTO assets (id, kind, size_bytes, original_filename, availability, created_at, updated_at)
       VALUES (?, 'video', 10, 'clip.mov', 'online', 1, 1)`,
      assetId,
    );
    const location = unwrap(
      createAssetLocationRepository(db).add({
        assetId,
        sourceId: source.id,
        storage: 'managed',
        relativePath: 'clip.mov',
        absolutePathCached: '/Users/me/In/clip.mov',
        sizeBytes: 10,
        state: 'present',
      }),
    );
    const projectId = newId<'Project'>();
    sql(db, `INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, 'Goa', 1, 1)`, projectId);
    const batchId = newId<'RenderBatch'>();
    const batched = seedRender(db, projectId, { presetId: 'reels', batchId });
    const single = seedRender(db, projectId, { presetId: 'reels' });

    unwrap(db.migrateTo(19));
    expect(get(db, 'SELECT kind FROM sources WHERE id = ?', source.id)).toEqual({ kind: 'wifi_import' });
    expect(get(db, 'SELECT source_id FROM asset_locations WHERE id = ?', location.id)).toEqual({
      source_id: source.id,
    });
    expect(db.driver.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(get(db, 'SELECT batch_id FROM renders WHERE id = ?', batched)).toEqual({ batch_id: batchId });
    expect(get(db, 'SELECT batch_id FROM renders WHERE id = ?', single)).toEqual({ batch_id: null });
    expect(get(db, 'SELECT provenance FROM assets WHERE id = ?', assetId)).toEqual({
      provenance: '{"kind":"captured"}',
    });

    expect(() => licenceRow(db, assetId, '101', 0)).toThrow(); // NC never lands here
    licenceRow(db, assetId, '101', 1);
    expect(() => licenceRow(db, assetId, '101', 1)).toThrow(); // one row per provider id
    expect(() => sql(db, `UPDATE assets SET provenance = 'not json' WHERE id = ?`, assetId)).toThrow();
    unwrap(createSourceRepository(db).add({ kind: 'stock_import', displayName: 'Stock', rootPath: '/S' }));

    unwrap(db.migrateTo(19)); // already there: nothing runs twice
    expect(db.schemaVersion()).toBe(19);
  });

  it('refuses to go down while a stock source exists, then goes down and up once it is gone', () => {
    const db = openTestDb({ targetVersion: 19 });
    const stock = unwrap(
      createSourceRepository(db).add({ kind: 'stock_import', displayName: 'Stock', rootPath: '/S' }),
    );
    const kept = unwrap(
      createSourceRepository(db).add({ kind: 'watched_folder', displayName: 'Camera', rootPath: '/C' }),
    );
    const refused = db.migrateTo(18);
    expect(!refused.ok && refused.error.code).toBe('library.migration_failed');
    expect(db.schemaVersion()).toBe(19);
    expect(get(db, 'SELECT count(*) AS n FROM sources')).toEqual({ n: 2 });

    sql(db, 'DELETE FROM sources WHERE id = ?', stock.id);
    unwrap(db.migrateTo(18));
    expect(get(db, 'SELECT kind FROM sources WHERE id = ?', kept.id)).toEqual({ kind: 'watched_folder' });
    for (const table of ['asset_licences', 'stock_search_cache'])
      expect(get(db, `SELECT count(*) AS n FROM sqlite_schema WHERE name = ?`, table)).toEqual({ n: 0 });
    unwrap(db.migrateTo(19));
    expect(get(db, 'SELECT kind FROM sources WHERE id = ?', kept.id)).toEqual({ kind: 'watched_folder' });
  });
});
