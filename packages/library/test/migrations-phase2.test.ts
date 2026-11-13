// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Migrations 12 and 13 (P2-L1, P2-L10): backfills, foreign keys, and the FTS triggers. */
import { newId, unwrap } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { type LibraryDatabase } from '../src/index';
import { openTestDb } from './helpers';

function run(db: LibraryDatabase, sql: string, ...params: (string | number | null)[]) {
  return db.driver.prepare(sql).run(...params);
}
const all = (db: LibraryDatabase, sql: string, ...params: string[]) => db.driver.prepare(sql).all(...params);

function seedV11(db: LibraryDatabase) {
  const sourceId = newId<'Source'>();
  const [kept, rotated, alone] = [newId<'Asset'>(), newId<'Asset'>(), newId<'Asset'>()];
  run(
    db,
    `INSERT INTO sources (id, kind, display_name, root_path, status, created_at, updated_at)
     VALUES (?, 'watched_folder', 'Trip', '/Trip', 'online', 0, 0)`,
    sourceId,
  );
  const asset = `INSERT INTO assets (id, kind, size_bytes, original_filename, width, height, rotation_degrees,
     availability, created_at) VALUES (?, 'video', 1, ?, ?, ?, ?, 'missing', ?)`;
  run(db, asset, kept, 'São Paulo.mov', 1920, 1080, 0, 100);
  run(db, asset, rotated, 'rotated.mov', 1920, 1080, 90, 200);
  run(db, asset, alone, 'alone.mov', null, null, null, 300);
  run(
    db,
    `INSERT INTO asset_locations (id, asset_id, source_id, storage, relative_path, size_bytes, state)
     VALUES (?, ?, ?, 'referenced', 'a.mov', 1, 'present'), (?, ?, ?, 'referenced', 'b.mov', 1, 'present')`,
    newId<'AssetLocation'>(),
    kept,
    sourceId,
    newId<'AssetLocation'>(),
    rotated,
    sourceId,
  );
  run(
    db,
    `INSERT INTO shots (id, asset_id, index_in_asset, start_value, start_rate_num, start_rate_den,
       duration_value, duration_rate_num, duration_rate_den) VALUES (?, ?, 0, 0, 24, 1, 48, 24, 1)`,
    newId<'Shot'>(),
    kept,
  );
  return { kept, rotated, alone };
}

const fts = (db: LibraryDatabase, query: string) =>
  all(
    db,
    `SELECT r.shot_id AS id FROM shot_fts f JOIN shot_search_rows r ON r.rowid = f.rowid WHERE shot_fts MATCH ?`,
    query,
  ).map((r) => r.id);

describe('migration 12: media library v2', () => {
  it('backfills orientation, times and detached assets, and goes back down', () => {
    const db = openTestDb({ targetVersion: 11 });
    const { kept, rotated, alone } = seedV11(db);
    unwrap(db.migrateTo(13));
    const asset = (id: string) =>
      db.driver
        .prepare('SELECT orientation, updated_at, detached_at, generation FROM assets WHERE id = ?')
        .get(id);
    expect(asset(kept)).toEqual({
      orientation: 'landscape',
      updated_at: 100,
      detached_at: null,
      generation: 0,
    });
    expect(asset(rotated)).toMatchObject({ orientation: 'portrait', detached_at: null });
    expect(asset(alone)).toMatchObject({ orientation: null, detached_at: 300 });
    expect(db.driver.prepare('SELECT created_at, best_take FROM shots').get()).toEqual({
      created_at: 100,
      best_take: 1,
    });
    expect(db.driver.prepare('SELECT watch, scan_state FROM sources').get()).toEqual({
      watch: 1,
      scan_state: 'idle',
    });
    expect(db.driver.prepare('SELECT via FROM asset_locations LIMIT 1').get()).toEqual({ via: 'scan' });
    // The existing shot is searchable by its file name (backfilled into the FTS index).
    expect(fts(db, '"sao"')).toHaveLength(1);

    unwrap(db.migrateTo(11));
    expect(all(db, 'PRAGMA table_info(assets)').map((c) => c.name)).not.toContain('facts');
    expect(all(db, "SELECT name FROM sqlite_schema WHERE name IN ('shot_fts', 'transcripts')")).toEqual([]);
    unwrap(db.migrateTo(13));
  });

  it('keeps foreign keys: stage rows, transcripts and derived files go with their asset', () => {
    const db = openTestDb();
    const { kept } = seedV11Fresh(db);
    run(
      db,
      `INSERT INTO transcripts (asset_id, transcript, language, engine, local, text, generation, created_at)
      VALUES (?, '{}', 'en', 'parakeet', 1, 'hi', 0, 0)`,
      kept,
    );
    run(
      db,
      `INSERT INTO asset_index_stages (asset_id, stage, state, updated_at) VALUES (?, 'library.hash', 'done', 0)`,
      kept,
    );
    expect(() =>
      run(
        db,
        `INSERT INTO asset_index_stages (asset_id, stage, state, updated_at) VALUES (?, 'x.y', 'done', 0)`,
        'nope',
      ),
    ).toThrow();
    expect(() =>
      run(
        db,
        `INSERT INTO asset_index_stages (asset_id, stage, state, output, updated_at) VALUES (?, 'x.y', 'done', ?, 0)`,
        kept,
        `"${'x'.repeat(1_048_577)}"`,
      ),
    ).toThrow(); // outputs over 1 MiB are refused
    run(db, 'DELETE FROM assets WHERE id = ?', kept);
    expect(all(db, 'SELECT * FROM transcripts')).toEqual([]);
    expect(all(db, 'SELECT * FROM asset_index_stages')).toEqual([]);
  });
});

function seedV11Fresh(db: LibraryDatabase) {
  unwrap(db.migrateTo(11));
  const ids = seedV11(db);
  unwrap(db.migrateTo(db.opened.migration?.to ?? 13));
  return ids;
}

describe('migration 13: shot keyword search', () => {
  it('follows inserts, updates, deletes and renames, with Devanagari words whole and diacritics folded', () => {
    const db = openTestDb();
    const { kept } = seedV11Fresh(db);
    const shot = newId<'Shot'>();
    run(
      db,
      `INSERT INTO shots (id, asset_id, index_in_asset, start_value, start_rate_num, start_rate_den,
         duration_value, duration_rate_num, duration_rate_den, description, objects, place, transcript_text,
         on_screen_text) VALUES (?, ?, 1, 48, 24, 1, 24, 24, 1, 'Golden sunset', ?, 'beach', 'नमस्ते दोस्तों', 'शुभ दीपावली')`,
      shot,
      kept,
      ['sun', 'sea'].join('\u001f'),
    );
    expect(fts(db, '"sunset"')).toEqual([shot]);
    expect(fts(db, 'labels:"sea"')).toEqual([shot]);
    expect(fts(db, '"नमस्ते"')).toEqual([shot]);
    expect(fts(db, '"नमस"')).toEqual([]); // the vowel sign and virama stay inside the word
    expect(fts(db, '"दीपावली"')).toEqual([shot]);
    run(db, `UPDATE shots SET description = 'Neon city' WHERE id = ?`, shot);
    expect(fts(db, '"sunset"')).toEqual([]);
    expect(fts(db, '"neon"')).toEqual([shot]);
    run(db, `UPDATE assets SET original_filename = 'Diwali.mov' WHERE id = ?`, kept);
    expect(fts(db, 'file_name:"diwali"')).toHaveLength(2);
    expect(fts(db, '"sao"')).toEqual([]);
    run(db, 'DELETE FROM shots WHERE id = ?', shot);
    expect(fts(db, '"neon"')).toEqual([]);
    expect(all(db, 'SELECT COUNT(*) AS n FROM shot_search_rows')).toEqual([{ n: 1 }]);
  });
});
