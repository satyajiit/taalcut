// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Migration 34 (LIB1-PLACE): `trips` and `asset_places`, and the asset's place words in its shots' FTS labels. An
 * asset's row goes with it, a trip's clips forget it when it goes, and a shot inserted, updated or relabelled carries
 * the words. Down puts migration 13's labels back; up again starts empty.
 */
import { unwrap, type AssetId } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createRepositories, type LibraryDatabase } from '../src/index';
import { keywordMatches } from '../src/search/fts';
import { openTestDb } from './helpers';
import { addAssets } from './indexing/harness';

const range = {
  start: { value: 0, rate: { num: 30, den: 1 } },
  duration: { value: 30, rate: { num: 30, den: 1 } },
};

const objects = (db: LibraryDatabase) =>
  db.driver
    .prepare(
      `SELECT name FROM sqlite_master WHERE (name LIKE 'trips%' OR name LIKE 'asset_places%')
         AND type IN ('table', 'trigger', 'index') ORDER BY name`,
    )
    .all()
    .map((row) => row.name);

const setWords = (db: LibraryDatabase, assetId: AssetId, words: string) =>
  db.driver
    .prepare(
      `INSERT INTO asset_places (asset_id, search_text, updated_at) VALUES (?, ?, 1)
       ON CONFLICT (asset_id) DO UPDATE SET search_text = excluded.search_text`,
    )
    .run(assetId, words);

describe('migration 34: places and trips', () => {
  it('feeds place words into the shots of the asset, and goes down and up again', () => {
    const db = openTestDb({ targetVersion: 33 });
    expect(objects(db)).toEqual([]);
    unwrap(db.migrateTo(34));
    expect(objects(db)).toEqual([
      'asset_places',
      'asset_places_country_idx',
      'asset_places_fts_on_delete',
      'asset_places_fts_on_insert',
      'asset_places_fts_on_update',
      'asset_places_trip_idx',
      'trips',
      'trips_started_idx',
    ]);
    const repos = createRepositories(db);
    const { assets } = addAssets(db, ['video', 'video']);
    const [a, b] = assets as [AssetId, AssetId];
    unwrap(repos.shots.replaceForAsset(a, 0, [range]));
    setWords(db, a, 'Lisbon Portugal');
    expect(keywordMatches(db, 'portugal', 10)).toHaveLength(1);
    // A shot made after the words carries them; one updated keeps them.
    setWords(db, b, 'Sintra Portugal');
    unwrap(repos.shots.replaceForAsset(b, 0, [range]));
    expect(keywordMatches(db, 'portugal', 10)).toHaveLength(2);
    db.driver.prepare(`UPDATE shots SET description = 'dancing' WHERE asset_id = ?`).run(b);
    expect(keywordMatches(db, 'sintra', 10)).toHaveLength(1);
    setWords(db, a, 'Goa India');
    expect(keywordMatches(db, 'portugal', 10)).toHaveLength(1);
    expect(keywordMatches(db, 'goa', 10)).toHaveLength(1);
    db.driver.prepare('DELETE FROM asset_places WHERE asset_id = ?').run(a);
    expect(keywordMatches(db, 'goa', 10)).toHaveLength(0);

    db.driver
      .prepare(
        `INSERT INTO trips (id, month, started_at, ended_at, clips, days, created_at, updated_at)
         VALUES ('t1', '2026-10', 1, 2, 1, 1, 1, 1)`,
      )
      .run();
    db.driver.prepare(`UPDATE asset_places SET trip_id = 't1' WHERE asset_id = ?`).run(b);
    db.driver.prepare(`DELETE FROM trips WHERE id = 't1'`).run();
    expect(db.driver.prepare('SELECT trip_id FROM asset_places WHERE asset_id = ?').get(b)).toEqual({
      trip_id: null,
    });
    expect(() =>
      db.driver
        .prepare(
          `INSERT INTO trips (id, month, started_at, ended_at, clips, days, created_at, updated_at)
           VALUES ('t2', '2026-10', 5, 2, 1, 1, 1, 1)`,
        )
        .run(),
    ).toThrow(/CHECK/);
    unwrap(repos.assets.remove(b));
    expect(db.driver.prepare('SELECT count(*) AS n FROM asset_places').get()).toEqual({ n: 0 });

    setWords(db, a, 'Lisbon');
    unwrap(db.migrateTo(33));
    expect(objects(db)).toEqual([]);
    expect(keywordMatches(db, 'lisbon', 10)).toHaveLength(0);
    unwrap(
      repos.shots.replaceForAsset(a, 0, [range, { ...range, start: { value: 30, rate: range.start.rate } }]),
    );
    unwrap(db.migrateTo(34));
    expect(db.driver.prepare('SELECT count(*) AS n FROM trips').get()).toEqual({ n: 0 });
  });
});
