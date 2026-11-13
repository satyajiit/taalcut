// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { join } from 'node:path';
import { unwrap } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import {
  LIBRARY_MIGRATIONS,
  MigrationFailed,
  MigrationMismatch,
  openDatabase,
  SchemaTooNew,
  type Migration,
} from '../src/index';
import { fakeClock, openTestDb, tempDir } from './helpers';

const LATEST = LIBRARY_MIGRATIONS.length;
const VERSIONS = LIBRARY_MIGRATIONS.map((m) => m.version);

function tables(db: { driver: { prepare(sql: string): { all(): Record<string, unknown>[] } } }): string[] {
  return db.driver
    .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((r) => String(r.name));
}

describe('migrations', () => {
  it('migrates a new database to the latest version', () => {
    const db = openTestDb();
    expect(db.schemaVersion()).toBe(LIBRARY_MIGRATIONS.length);
    expect(db.opened.migration?.from).toBe(0);
    expect(db.opened.migration?.applied.map((m) => m.version)).toEqual(VERSIONS);
    expect(db.opened.migration?.backup).toBeNull(); // nothing to back up yet
    expect(tables(db)).toContain('commands');
    expect(db.driver.prepare('PRAGMA user_version').get()?.user_version).toBe(LATEST);
  });

  it('runs every migration down to 0 and back up again', () => {
    const db = openTestDb();
    const all = tables(db);
    const down = unwrap(db.migrateTo(0));
    expect(down?.applied.map((m) => `${m.version}${m.direction}`)).toEqual(
      [...VERSIONS].reverse().map((v) => `${v}down`),
    );
    expect(tables(db)).toEqual(['_migrations']);
    expect(db.schemaVersion()).toBe(0);
    const up = unwrap(db.migrateTo(LATEST));
    expect(up?.applied.map((m) => `${m.version}${m.direction}`)).toEqual(VERSIONS.map((v) => `${v}up`));
    expect(tables(db)).toEqual(all);
  });

  it('steps down one version at a time', () => {
    const db = openTestDb();
    const sourceColumns = () =>
      db.driver
        .prepare('PRAGMA table_info(sources)')
        .all()
        .map((c) => c.name);
    expect(sourceColumns()).toContain('display_name'); // ADR 0001 shape (migration 4)
    unwrap(db.migrateTo(3));
    expect(tables(db)).not.toContain('asset_locations');
    expect(sourceColumns()).toContain('label'); // migration 2's provisional shape is back
    unwrap(db.migrateTo(2));
    expect(tables(db)).not.toContain('vector_indexes');
    expect(tables(db)).toContain('sources');
    unwrap(db.migrateTo(1));
    expect(tables(db)).not.toContain('sources');
    expect(tables(db)).toContain('jobs');
  });

  it('opens an existing database without re-running migrations', () => {
    const path = join(tempDir(), 'library.db');
    unwrap(openDatabase({ path })).close();
    const again = unwrap(openDatabase({ path }));
    expect(again.opened.migration).toBeNull();
    again.close();
  });

  it('backs up before migrating an existing database', () => {
    const clock = fakeClock();
    const path = join(tempDir(), 'library.db');
    unwrap(openDatabase({ path, targetVersion: 1, clock: clock.now })).close();
    clock.advance(1000);
    const db = unwrap(openDatabase({ path, clock: clock.now }));
    const backup = db.opened.migration?.backup;
    expect(backup).toMatchObject({
      schemaVersion: 1,
      reason: `pre-migrate-to-v${LATEST}`,
      createdAt: clock.now(),
    });
    expect(db.listBackups().map((b) => b.path)).toEqual([backup?.path]);
    db.close();
  });

  it('rolls back the whole run when a migration fails', () => {
    const broken: Migration = {
      version: LATEST + 1,
      name: 'broken',
      up: 'CREATE TABLE ok_table (x INTEGER); SELEC nonsense;',
      down: '',
    };
    const path = join(tempDir(), 'library.db');
    unwrap(openDatabase({ path, targetVersion: 2 })).close();
    const result = openDatabase({ path, migrations: [...LIBRARY_MIGRATIONS, broken] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(MigrationFailed.is(result.error)).toBe(true);
      expect(result.error.params).toEqual({ version: LATEST + 1, direction: 'up' });
    }
    // Neither 3 nor 4 applied: one transaction for the whole run.
    const db = unwrap(openDatabase({ path, targetVersion: 2 }));
    expect(db.schemaVersion()).toBe(2);
    expect(tables(db)).not.toContain('ok_table');
    expect(tables(db)).not.toContain('vector_indexes');
    db.close();
  });

  it('fails a migration that leaves foreign key violations', () => {
    const orphan: Migration = {
      version: LATEST + 1,
      name: 'orphan',
      up: "INSERT INTO conversations (id, project_id, created_at, updated_at) VALUES ('c', 'missing', 0, 0);",
      down: "DELETE FROM conversations WHERE id = 'c';",
    };
    const result = openDatabase({ path: ':memory:', migrations: [...LIBRARY_MIGRATIONS, orphan] });
    expect(!result.ok && MigrationFailed.is(result.error)).toBe(true);
  });

  it('refuses a database newer than the app', () => {
    const path = join(tempDir(), 'library.db');
    unwrap(openDatabase({ path })).close();
    const result = openDatabase({ path, migrations: LIBRARY_MIGRATIONS.slice(0, 2) });
    expect(!result.ok && SchemaTooNew.is(result.error)).toBe(true);
    if (!result.ok) expect(result.error.params).toEqual({ version: LATEST, supported: 2 });
  });

  it('refuses a migration that was edited after it was applied', () => {
    const path = join(tempDir(), 'library.db');
    unwrap(openDatabase({ path })).close();
    const edited = LIBRARY_MIGRATIONS.map((m) => (m.version === 2 ? { ...m, up: `${m.up}\n-- edited` } : m));
    const result = openDatabase({ path, migrations: edited });
    expect(!result.ok && MigrationMismatch.is(result.error)).toBe(true);
  });

  it('rejects a malformed migration list as a bug', () => {
    const gap = [LIBRARY_MIGRATIONS[0]!, { ...LIBRARY_MIGRATIONS[2]! }];
    expect(() => openDatabase({ path: ':memory:', migrations: gap })).toThrow(/expected 2/);
  });

  it('keeps foreign keys on after migrating', () => {
    const db = openTestDb({ file: false });
    expect(db.driver.prepare('PRAGMA foreign_keys').get()?.foreign_keys).toBe(1);
  });
});
