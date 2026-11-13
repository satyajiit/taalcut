// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Migration 35 (LIB1-LANG): `asset_spoken_language`. The checks hold the outcome to valid JSON and the chosen
 * language to a tag's length; the row goes with its asset. Down removes the table; up again starts empty.
 */
import { unwrap } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createRepositories } from '../src/index';
import { openTestDb } from './helpers';

const tables = (db: ReturnType<typeof openTestDb>) =>
  db.driver
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'asset_spoken_language'`)
    .all()
    .map((row) => row.name);

describe('migration 35: a clip’s spoken language', () => {
  it('creates the table, holds rows to their shape, goes with the asset, and goes down and up again', () => {
    const db = openTestDb({ targetVersion: 34 });
    expect(tables(db)).toEqual([]);
    unwrap(db.migrateTo(35));
    expect(tables(db)).toEqual(['asset_spoken_language']);

    const asset = unwrap(
      createRepositories(db).assets.create({ kind: 'video', sizeBytes: 1, originalFilename: 'a.mov' }),
    );
    const row =
      (outcome: string | null, chosen: string | null, id: string = asset.id) =>
      () =>
        db.driver
          .prepare(
            `INSERT INTO asset_spoken_language (asset_id, outcome, chosen, updated_at) VALUES (?, ?, ?, 1)`,
          )
          .run(id, outcome, chosen);
    expect(row('not json', null)).toThrow(/CHECK/);
    expect(row(null, 'x')).toThrow(/CHECK/);
    expect(row(null, 'hi', 'no-such-asset')).toThrow(/FOREIGN KEY/);
    row('{"state":"unclear","languages":[],"confidence":0.3}', 'or')();
    expect(row(null, 'hi')).toThrow(/UNIQUE|PRIMARY KEY/);

    db.driver.prepare('DELETE FROM assets WHERE id = ?').run(asset.id);
    expect(db.driver.prepare('SELECT count(*) AS n FROM asset_spoken_language').get()).toEqual({ n: 0 });

    unwrap(db.migrateTo(34));
    expect(tables(db)).toEqual([]);
    unwrap(db.migrateTo(35));
    expect(db.driver.prepare('SELECT count(*) AS n FROM asset_spoken_language').get()).toEqual({ n: 0 });
  });
});
