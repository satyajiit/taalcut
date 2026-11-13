// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Migration 26 (index milestones, IX-R1) with data: an asset's finish lines and the stage registry arrive empty
 * (the pipeline backfills the lines when it starts), go with their asset, use the new `updated_at` index for the
 * sweep, and down drops them while every stage row stays.
 */
import { unwrap, type AssetId } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import type { LibraryDatabase } from '../src/index';
import { openTestDb } from './helpers';
import { addAssets } from './indexing/harness';

const all = (db: LibraryDatabase, text: string, ...params: (string | number)[]) =>
  db.driver.prepare(text).all(...params);
const tables = (db: LibraryDatabase) =>
  all(
    db,
    "SELECT name FROM sqlite_schema WHERE type = 'table' AND name IN ('asset_index_state', 'index_stages') ORDER BY name",
  ).map((row) => row.name);

describe('migration 26: index milestones', () => {
  it('adds the finish lines and the registry, keeps stage rows, and goes down and up again', () => {
    const db = openTestDb({ targetVersion: 25 });
    const [asset] = addAssets(db, ['video']).assets as [AssetId];
    db.driver
      .prepare(
        `INSERT INTO asset_index_stages (asset_id, stage, state, finished_at, updated_at)
         VALUES (?, 'library.hash', 'done', 5, 5)`,
      )
      .run(asset);

    unwrap(db.migrateTo(26));
    expect(tables(db)).toEqual(['asset_index_state', 'index_stages']);
    expect(all(db, 'SELECT COUNT(*) AS n FROM asset_index_state')).toEqual([{ n: 0 }]);
    const plan = all(
      db,
      'EXPLAIN QUERY PLAN SELECT asset_id FROM asset_index_stages WHERE updated_at >= ?',
      0,
    ).map((row) => row.detail);
    expect(plan.join(' ')).toContain('asset_index_stages_updated_idx');
    expect(() =>
      db.driver
        .prepare(`INSERT INTO index_stages (stage, position, milestone) VALUES ('a.b', 0, 'soon')`)
        .run(),
    ).toThrow();

    db.driver
      .prepare('INSERT INTO asset_index_state (asset_id, searchable_at, complete_at) VALUES (?, 6, NULL)')
      .run(asset);
    db.driver.prepare('DELETE FROM assets WHERE id = ?').run(asset);
    expect(all(db, 'SELECT COUNT(*) AS n FROM asset_index_state')).toEqual([{ n: 0 }]);

    const [kept] = addAssets(db, ['image'], { sourceName: 'Kept' }).assets as [AssetId];
    db.driver
      .prepare(
        `INSERT INTO asset_index_stages (asset_id, stage, state, updated_at) VALUES (?, 'library.hash', 'done', 7)`,
      )
      .run(kept);
    unwrap(db.migrateTo(25));
    expect(tables(db)).toEqual([]);
    expect(all(db, 'SELECT asset_id FROM asset_index_stages')).toEqual([{ asset_id: kept }]);
    unwrap(db.migrateTo(26));
    expect(tables(db)).toEqual(['asset_index_state', 'index_stages']);
  });
});
