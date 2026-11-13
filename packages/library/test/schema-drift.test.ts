// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The SQL migrations create the schema; the Drizzle tables type the queries.
 * This test fails when the two disagree on tables, columns, types, nullability,
 * primary keys or index names.
 */
import { is } from 'drizzle-orm';
import { getTableConfig, SQLiteTable } from 'drizzle-orm/sqlite-core';
import { describe, expect, it } from 'vitest';
import * as schema from '../src/schema';
import { openTestDb } from './helpers';

const drizzleTables: SQLiteTable[] = Object.values(schema).filter((value) => is(value, SQLiteTable));
const entries = drizzleTables.map((table) => ({ name: getTableConfig(table).name, table }));

function fromDrizzle(table: SQLiteTable) {
  const config = getTableConfig(table);
  const compositePk = new Set(config.primaryKeys.flatMap((pk) => pk.columns.map((c) => c.name)));
  const columns = config.columns
    .map((c) => ({
      name: c.name,
      type: c.getSQLType().toUpperCase(),
      notNull: c.notNull,
      pk: c.primary || compositePk.has(c.name),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const indexes = [
    ...config.indexes.map((i) => ({ name: i.config.name, unique: i.config.unique })),
    ...config.uniqueConstraints.map((u) => ({ name: u.name!, unique: true })),
    ...config.columns.filter((c) => c.isUnique).map((c) => ({ name: c.uniqueName!, unique: true })),
  ].sort((a, b) => a.name.localeCompare(b.name));
  return { name: config.name, columns, indexes };
}

describe('schema drift', () => {
  const db = () => openTestDb({ file: false });

  it('has a Drizzle table for every migrated table and no extras', () => {
    const rows = db()
      .driver.prepare(
        "SELECT name, sql FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> '_migrations' ORDER BY name",
      )
      .all()
      .map((r) => ({ name: String(r.name), sql: String(r.sql) }));
    // FTS5 tables (and the shadow tables they own) have no Drizzle table: they are queried with SQL.
    const virtual = rows.filter((r) => r.sql.startsWith('CREATE VIRTUAL TABLE')).map((r) => r.name);
    const migrated = rows
      .map((r) => r.name)
      .filter((name) => !virtual.some((v) => name === v || name.startsWith(`${v}_`)));
    expect(virtual.length).toBeGreaterThan(0);
    expect(entries.map((e) => e.name).sort()).toEqual(migrated);
  });

  it.each(entries)('$name matches its migration', ({ name, table }) => {
    const database = db();
    const expected = fromDrizzle(table);
    const columns = database.driver
      .prepare(`PRAGMA table_xinfo(${name})`)
      .all()
      .map((c) => ({
        name: String(c.name),
        type: String(c.type),
        notNull: c.notnull === 1,
        pk: Number(c.pk) > 0,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const indexes = database.driver
      .prepare(`PRAGMA index_list(${name})`)
      .all()
      .filter((i) => i.origin !== 'pk')
      .map((i) => ({ name: String(i.name), unique: i.unique === 1 }))
      .sort((a, b) => a.name.localeCompare(b.name));
    expect({ name, columns, indexes }).toEqual(expected);
  });
});
