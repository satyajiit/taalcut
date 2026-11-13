// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Migration 27 (stage output digests, IX3-I3) with data: every stage row an older library holds is kept as it was
 * and gets a null digest (the pipeline records it from what is stored), a reset keeps a digest, and down drops the
 * column while every row stays.
 */
import { unwrap, type AssetId } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createStageRows, type LibraryDatabase } from '../src/index';
import { openTestDb } from './helpers';
import { addAssets } from './indexing/harness';

const all = (db: LibraryDatabase, text: string, ...params: (string | number)[]) =>
  db.driver.prepare(text).all(...params);
const columns = (db: LibraryDatabase) =>
  all(db, "SELECT name FROM pragma_table_info('asset_index_stages') WHERE name = 'output_digest'").map(
    (row) => row.name,
  );

describe('migration 27: stage output digests', () => {
  it('adds a null digest to every stage row, keeps the rows, and goes down and up again', () => {
    const db = openTestDb({ targetVersion: 26 });
    const [asset] = addAssets(db, ['video']).assets as [AssetId];
    db.driver
      .prepare(
        `INSERT INTO asset_index_stages (asset_id, stage, state, version, output, finished_at, updated_at)
         VALUES (?, 'vision.shots', 'done', 2, '{"frameCount":3}', 5, 5)`,
      )
      .run(asset);

    unwrap(db.migrateTo(27));
    expect(columns(db)).toEqual(['output_digest']);
    expect(all(db, 'SELECT stage, state, version, output, output_digest FROM asset_index_stages')).toEqual([
      { stage: 'vision.shots', state: 'done', version: 2, output: '{"frameCount":3}', output_digest: null },
    ]);

    // A reset (re-index, version rise, invalidation) keeps the digest: it names what is still stored.
    db.driver.prepare(`UPDATE asset_index_stages SET output_digest = 'abc'`).run();
    createStageRows(db).reset([asset], ['vision.shots']);
    expect(all(db, 'SELECT state, output_digest FROM asset_index_stages')).toEqual([
      { state: 'waiting', output_digest: 'abc' },
    ]);

    unwrap(db.migrateTo(26));
    expect(columns(db)).toEqual([]);
    expect(all(db, 'SELECT stage, state FROM asset_index_stages')).toEqual([
      { stage: 'vision.shots', state: 'waiting' },
    ]);
    unwrap(db.migrateTo(27));
    expect(columns(db)).toEqual(['output_digest']);
  });
});
