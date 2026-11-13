// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Migrations that convert rows keep what the rows mean, in both directions. */
import { join } from 'node:path';
import { newId, unwrap } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { MigrationMismatch, openDatabase, type LibraryDatabase } from '../src/index';
import { openTestDb, tempDir } from './helpers';

function row(db: LibraryDatabase, sql: string, ...params: (string | number)[]) {
  return db.driver.prepare(sql).get(...params);
}

function triggers(db: LibraryDatabase): string[] {
  return db.driver
    .prepare("SELECT name FROM sqlite_schema WHERE type = 'trigger' ORDER BY name")
    .all()
    .map((r) => String(r.name));
}

describe('migration 8: rational rates (review 2: one integer rate lost NTSC)', () => {
  it('turns an integer rate into num/den and back without changing any duration', () => {
    const db = openTestDb({ targetVersion: 7 });
    const before = triggers(db);
    const sourceId = newId<'Source'>();
    const assetId = newId<'Asset'>();
    db.driver
      .prepare(
        `INSERT INTO sources (id, kind, display_name, root_path, status, created_at, updated_at)
         VALUES (?, 'watched_folder', 'Trip', '/Trip', 'online', 0, 0)`,
      )
      .run(sourceId);
    db.driver
      .prepare(
        `INSERT INTO assets (id, kind, size_bytes, original_filename, duration_value, duration_rate,
           availability, created_at) VALUES (?, 'video', 1, 'a.mov', 48, 24, 'missing', 0)`,
      )
      .run(assetId);
    db.driver
      .prepare(
        `INSERT INTO shots (id, asset_id, index_in_asset, start_value, start_rate, duration_value, duration_rate)
         VALUES (?, ?, 0, 24, 24, 48, 24)`,
      )
      .run(newId<'Shot'>(), assetId);

    unwrap(db.migrateTo(8));
    expect(row(db, 'SELECT duration_value, duration_rate_num, duration_rate_den FROM assets')).toEqual({
      duration_value: 48,
      duration_rate_num: 24,
      duration_rate_den: 1,
    });
    expect(row(db, 'SELECT start_value, start_rate_num, start_rate_den FROM shots')).toEqual({
      start_value: 24,
      start_rate_num: 24,
      start_rate_den: 1,
    });
    expect(triggers(db)).toEqual(before);
    // The rebuilt table still derives availability from its locations.
    db.driver
      .prepare(
        `INSERT INTO asset_locations (id, asset_id, source_id, storage, relative_path, size_bytes, state)
         VALUES (?, ?, ?, 'referenced', 'a.mov', 1, 'present')`,
      )
      .run(newId<'AssetLocation'>(), assetId, sourceId);
    expect(row(db, 'SELECT availability FROM assets WHERE id = ?', assetId)).toEqual({
      availability: 'online',
    });
    const ntscId = newId<'Asset'>();
    db.driver
      .prepare(
        `INSERT INTO assets (id, kind, size_bytes, original_filename, duration_value, duration_rate_num,
           duration_rate_den, availability, created_at) VALUES (?, 'video', 1, 'b.mov', 24000, 24000, 1001, 'missing', 0)`,
      )
      .run(ntscId);

    unwrap(db.migrateTo(7));
    expect(row(db, 'SELECT duration_value, duration_rate FROM assets WHERE id = ?', assetId)).toEqual({
      duration_value: 48,
      duration_rate: 24,
    });
    // 24000 frames at 24000/1001 is 1001 s; one integer rate keeps that as 24024000 at 24000.
    expect(row(db, 'SELECT duration_value, duration_rate FROM assets WHERE id = ?', ntscId)).toEqual({
      duration_value: 24_024_000,
      duration_rate: 24000,
    });
    expect(row(db, 'SELECT start_value, start_rate FROM shots')).toEqual({ start_value: 24, start_rate: 24 });
    expect(triggers(db)).toEqual(before);
    expect(row(db, 'PRAGMA foreign_key_check')).toBeUndefined();
  });
});

describe('migration 5 down (review 2: a failed and a queued job sharing a key)', () => {
  it('keeps the live job’s key and drops the failed one’s, so v4’s unique key holds', () => {
    const db = openTestDb();
    const insert = db.driver.prepare(
      `INSERT INTO jobs (id, kind, state, resource_class, idempotency_key, payload, created_at, updated_at)
       VALUES (?, 'probe.down', ?, 'cpu', 'retry-key', '{}', 1, 1)`,
    );
    const failed = newId<'Job'>();
    const queued = newId<'Job'>();
    insert.run(failed, 'failed');
    insert.run(queued, 'queued');
    unwrap(db.migrateTo(4));
    expect(db.schemaVersion()).toBe(4);
    const keys = db.driver.prepare('SELECT id, idempotency_key AS key FROM jobs ORDER BY id').all();
    expect(Object.fromEntries(keys.map((r) => [r.id, r.key]))).toEqual({
      [failed]: null,
      [queued]: 'retry-key',
    });
    unwrap(db.migrateTo(8));
  });

  it('still opens a database that applied the earlier text of migration 5', () => {
    const path = join(tempDir(), 'library.db');
    const db = unwrap(openDatabase({ path }));
    db.driver.prepare("UPDATE _migrations SET checksum = '470abedb5adcd107' WHERE version = 5").run();
    db.close();
    unwrap(openDatabase({ path })).close();
    const edited = unwrap(openDatabase({ path }));
    edited.driver.prepare("UPDATE _migrations SET checksum = '0000000000000000' WHERE version = 5").run();
    edited.close();
    const result = openDatabase({ path });
    expect(!result.ok && MigrationMismatch.is(result.error)).toBe(true);
  });
});
