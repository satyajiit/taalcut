// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Migration 30 (LRN1-MEM): `memory_items` and its search table. The checks hold the row to core's MemoryItem: a
 * scope names exactly its project or template, text is 1..500 characters, data comes with its kind. Down removes
 * both tables and the triggers; up again starts empty.
 */
import { unwrap } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import type { LibraryDatabase } from '../src/index';
import { openTestDb } from './helpers';

const insert = (db: LibraryDatabase, row: Record<string, string | number | null>) => {
  const values = {
    id: 'm1',
    scope: 'user',
    project_id: null,
    template_id: null,
    text: 'Never use whip transitions.',
    source: 'user',
    data_kind: null,
    data: null,
    revision: 1,
    ...row,
  };
  return () =>
    db.driver
      .prepare(
        `INSERT INTO memory_items (id, scope, project_id, template_id, text, source, data_kind, data, revision,
           created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)`,
      )
      .run(
        values.id,
        values.scope,
        values.project_id,
        values.template_id,
        values.text,
        values.source,
        values.data_kind,
        values.data,
        values.revision,
      );
};

const tables = (db: LibraryDatabase) =>
  db.driver
    .prepare(
      "SELECT name FROM sqlite_master WHERE name LIKE 'memory_%' AND type IN ('table', 'trigger') ORDER BY name",
    )
    .all()
    .map((row) => row.name);

describe('migration 30: agent memory', () => {
  it('creates the items and their search rows, holds rows to the item shape, and goes down and up again', () => {
    const db = openTestDb({ targetVersion: 29 });
    expect(tables(db)).toEqual([]);
    unwrap(db.migrateTo(30));
    expect(tables(db)).toEqual(
      expect.arrayContaining([
        'memory_items',
        'memory_fts',
        'memory_fts_on_insert',
        'memory_fts_on_update',
        'memory_fts_on_delete',
      ]),
    );

    insert(db, {})();
    expect(db.driver.prepare("SELECT memory_id FROM memory_fts WHERE memory_fts MATCH 'whip'").all()).toEqual(
      [{ memory_id: 'm1' }],
    );
    expect(insert(db, { id: 'm2', scope: 'project' })).toThrow(/CHECK/);
    expect(insert(db, { id: 'm3', template_id: 'tpl' })).toThrow(/CHECK|FOREIGN KEY/);
    expect(insert(db, { id: 'm4', text: '' })).toThrow(/CHECK/);
    expect(insert(db, { id: 'm5', text: 'x'.repeat(501) })).toThrow(/CHECK/);
    expect(insert(db, { id: 'm6', source: 'model' })).toThrow(/CHECK/);
    expect(insert(db, { id: 'm7', data: '{}' })).toThrow(/CHECK/);
    expect(insert(db, { id: 'm8', data_kind: 'what-worked', data: 'not json' })).toThrow(/CHECK/);
    expect(insert(db, { id: 'm9', revision: 0 })).toThrow(/CHECK/);

    unwrap(db.migrateTo(29));
    expect(tables(db)).toEqual([]);
    unwrap(db.migrateTo(30));
    expect(db.driver.prepare('SELECT count(*) AS n FROM memory_items').get()).toEqual({ n: 0 });
  });
});
