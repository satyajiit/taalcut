// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Migration 24 (template name keys, P3-B1) with data: every stored name gets its Unicode key in the same
 * transaction, the name index moves to the key, and down goes back to the NOCASE index and up fills again.
 */
import { newId, unwrap } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import type { LibraryDatabase } from '../src/index';
import { openTestDb } from './helpers';

const all = (db: LibraryDatabase, text: string) => db.driver.prepare(text).all();
const indexes = (db: LibraryDatabase) =>
  all(
    db,
    "SELECT name FROM sqlite_schema WHERE type = 'index' AND tbl_name = 'templates' AND name LIKE '%name%'",
  );

describe('migration 24: template name keys', () => {
  it('keys every stored name, moves the index, and goes down and up again', () => {
    const db = openTestDb({ targetVersion: 23 });
    const insert = db.driver.prepare(
      `INSERT INTO templates (id, name, listed, head_version, created_at, updated_at) VALUES (?, ?, 1, 1, 1, 1)`,
    );
    for (const name of ['Árbol', 'zebra', 'ÉCLAIR', 'ग्राम']) insert.run(newId<'Template'>(), name);

    unwrap(db.migrateTo(24));
    expect(
      all(db, 'SELECT name_key FROM templates ORDER BY name_key, id').map((row) => row.name_key),
    ).toEqual(['arbol', 'eclair', 'zebra', 'ग्राम']);
    expect(indexes(db)).toEqual([
      { name: 'templates_name_key_asc_idx' },
      { name: 'templates_name_key_desc_idx' },
    ]);
    const plan = (order: string) =>
      all(db, `EXPLAIN QUERY PLAN SELECT id FROM templates ORDER BY ${order}`).map((row) => row.detail);
    expect(plan('name_key ASC, id DESC')).toEqual([
      'SCAN templates USING COVERING INDEX templates_name_key_asc_idx',
    ]);
    expect(plan('name_key DESC, id DESC')).toEqual([
      'SCAN templates USING COVERING INDEX templates_name_key_desc_idx',
    ]);

    unwrap(db.migrateTo(23));
    expect(all(db, "SELECT name FROM pragma_table_info('templates') WHERE name = 'name_key'")).toEqual([]);
    expect(indexes(db)).toEqual([{ name: 'templates_name_idx' }]);
    expect(all(db, 'SELECT count(*) AS n FROM templates')).toEqual([{ n: 4 }]);

    unwrap(db.migrateTo(24));
    expect(all(db, "SELECT name_key FROM templates WHERE name = 'Árbol'")).toEqual([{ name_key: 'arbol' }]);
  });
});
