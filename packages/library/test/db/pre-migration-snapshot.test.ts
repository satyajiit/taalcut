// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The update guard's pre-migration snapshot (P3-B9): taken only when a launch brings migrations for a database
 * that has data, named by the app versions beside the database, holding what the WAL had, the last two kept;
 * a version that can't name a file refuses the open.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { newId, unwrap } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { LIBRARY_MIGRATIONS, nodeSqliteDriver, openDatabase, readSchemaVersion } from '../../src/index';
import { tempDir } from '../helpers';

const LATEST = LIBRARY_MIGRATIONS.length;

/** The snapshot as the guard would put it back: its schema version and its projects. */
function readSnapshot(path: string) {
  const driver = nodeSqliteDriver.open(path, { allowExtensions: false });
  try {
    const names = driver.prepare('SELECT name FROM projects ORDER BY name').all();
    return { version: readSchemaVersion(driver), projects: names.map((row) => row.name) };
  } finally {
    driver.close();
  }
}

const addProject = (db: ReturnType<typeof openAt>, name: string) =>
  db.driver
    .prepare('INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, 1, 1)')
    .run(newId<'Project'>(), name);

function openAt(path: string, targetVersion: number, versions?: { from: string; to: string }) {
  return unwrap(
    openDatabase({ path, targetVersion, ...(versions ? { preMigrationSnapshot: versions } : {}) }),
  );
}

const snapshots = (dir: string) =>
  readdirSync(dir)
    .filter((name) => name.startsWith('pre-migrate-'))
    .sort();

describe('pre-migration snapshot', () => {
  it('clones the database before an update’s migrations, with what the WAL held', () => {
    const dir = tempDir();
    const path = join(dir, 'library.sqlite');
    const db = openAt(path, LATEST - 2, { from: '1.0.0', to: '1.1.0-beta.2' });
    // A first run migrates an empty database: nothing to roll back to.
    expect(snapshots(dir)).toEqual([]);
    addProject(db, 'Goa');
    unwrap(db.migrateTo(LATEST - 1));
    db.close();
    expect(snapshots(dir)).toEqual(['pre-migrate-1.0.0-1.1.0-beta.2.sqlite']);
    expect(readSnapshot(join(dir, 'pre-migrate-1.0.0-1.1.0-beta.2.sqlite'))).toEqual({
      version: LATEST - 2,
      projects: ['Goa'],
    });
  });

  it('takes none when nothing migrates or no versions are given', () => {
    const dir = tempDir();
    const path = join(dir, 'library.sqlite');
    openAt(path, LATEST - 1).close();
    openAt(path, LATEST - 1, { from: '1.0.0', to: '1.1.0' }).close();
    expect(snapshots(dir)).toEqual([]);
    openAt(path, LATEST).close();
    expect(snapshots(dir)).toEqual([]);
  });

  it('keeps the last two', () => {
    const dir = tempDir();
    const path = join(dir, 'library.sqlite');
    openAt(path, LATEST - 3).close();
    openAt(path, LATEST - 2, { from: '1.0.0', to: '1.1.0' }).close();
    openAt(path, LATEST - 1, { from: '1.1.0', to: '1.2.0' }).close();
    openAt(path, LATEST, { from: '1.2.0', to: '1.3.0' }).close();
    expect(snapshots(dir)).toEqual(['pre-migrate-1.1.0-1.2.0.sqlite', 'pre-migrate-1.2.0-1.3.0.sqlite']);
    expect(readSnapshot(join(dir, 'pre-migrate-1.2.0-1.3.0.sqlite')).version).toBe(LATEST - 1);
    expect(existsSync(join(dir, 'pre-migrate-1.2.0-1.3.0.sqlite.tmp'))).toBe(false);
  });

  it('refuses a version that can’t name a file, and migrates nothing', () => {
    const dir = tempDir();
    const path = join(dir, 'library.sqlite');
    openAt(path, LATEST - 1).close();
    const opened = openDatabase({ path, preMigrationSnapshot: { from: '../1.0.0', to: '1.1.0' } });
    expect(opened.ok ? null : opened.error.code).toBe('core.validation');
    expect(snapshots(dir)).toEqual([]);
    const db = openAt(path, LATEST - 1);
    expect(db.schemaVersion()).toBe(LATEST - 1);
    db.close();
  });
});
