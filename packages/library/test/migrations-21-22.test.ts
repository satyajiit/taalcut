// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Migrations 21 (hub client) and 22 (voice consents, generated assets) with data: up creates the tables with
 * their checks, running them again is a no-op, a generated row goes with its asset, and down takes them away
 * exactly (the tables before 21 are untouched), then up again.
 */
import { newId, unwrap } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import type { LibraryDatabase } from '../src/index';
import { openTestDb } from './helpers';

const run = (db: LibraryDatabase, text: string, ...params: (string | number | null)[]) =>
  db.driver.prepare(text).run(...params);
const tables = (db: LibraryDatabase) =>
  db.driver
    .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((row) => String(row.name));
const OURS = [
  'generated_assets',
  'hub_index_cache',
  'hub_ratings_cache',
  'hub_submissions',
  'voice_consents',
];

describe('migrations 21 and 22', () => {
  it('create the hub, consent and generated tables with their checks', () => {
    const db = openTestDb({ targetVersion: 20 });
    const before = tables(db);
    unwrap(db.migrateTo(22));
    expect(tables(db)).toEqual([...before, ...OURS].sort());
    unwrap(db.migrateTo(22)); // already there: nothing runs twice

    run(db, `INSERT INTO hub_index_cache (id, etag, fetched_at, body) VALUES (1, NULL, 1, '{}')`);
    expect(() => run(db, `INSERT INTO hub_index_cache (id, fetched_at, body) VALUES (2, 1, '{}')`)).toThrow();
    expect(() =>
      run(db, `INSERT INTO hub_ratings_cache (id, fetched_at, body) VALUES (1, 1, 'nope')`),
    ).toThrow();
    expect(() =>
      run(
        db,
        `INSERT INTO hub_submissions (id, hub_id, version, template_id, template_version, state, created_at)
         VALUES ('s', 'h', 1, 't', 1, 'lost', 1)`,
      ),
    ).toThrow();
    expect(() =>
      run(
        db,
        `INSERT INTO voice_consents (id, speaker_name, language, terms_version, recording_sha256,
           recording_duration_ms, phrase_match, recorded_at, updated_at)
         VALUES ('c', 'A', 'hi', '1', ?, 59999, 0.9, 1, 1)`,
        'a'.repeat(64),
      ),
    ).toThrow();

    const assetId = newId<'Asset'>();
    run(
      db,
      `INSERT INTO assets (id, kind, size_bytes, original_filename, availability, created_at, updated_at)
       VALUES (?, 'image', 1, 'image.png', 'missing', 1, 1)`,
      assetId,
    );
    run(
      db,
      'INSERT INTO generated_assets (asset_id, created_at, unreferenced_since) VALUES (?, 1, 1)',
      assetId,
    );
    run(db, 'DELETE FROM assets WHERE id = ?', assetId);
    expect(db.driver.prepare('SELECT count(*) AS n FROM generated_assets').get()).toEqual({ n: 0 });
  });

  it('go down exactly and up again', () => {
    const db = openTestDb({ targetVersion: 22 });
    unwrap(db.migrateTo(20));
    for (const name of OURS) expect(tables(db)).not.toContain(name);
    unwrap(db.migrateTo(22));
    for (const name of OURS) expect(tables(db)).toContain(name);
  });
});
