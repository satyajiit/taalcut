// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** P1-D2 "Done when": a corrupted database is detected on open and restored from the backup. */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { unwrap } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import {
  BackupFailed,
  DatabaseCorrupt,
  DatabaseOpenFailed,
  LIBRARY_MIGRATIONS,
  openDatabase,
  type LibraryDatabase,
} from '../src/index';
import { fakeClock, tempDir } from './helpers';

/** XORs `length` bytes at `offset` with 0xFF. */
function flipBytes(path: string, offset: number, length: number): void {
  const bytes = readFileSync(path);
  for (let i = offset; i < offset + length && i < bytes.length; i++) bytes[i] = bytes[i]! ^ 0xff;
  writeFileSync(path, bytes);
}

/** The data the tests follow: a setting, which every migration keeps (projects went in migration 42). */
function addSetting(db: LibraryDatabase, name: string): void {
  db.driver.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, '1', 0)`).run(name);
}

function settingNames(db: LibraryDatabase): string[] {
  return db.driver
    .prepare('SELECT key FROM settings ORDER BY key')
    .all()
    .map((row) => String(row.key));
}

/** A database with one setting in its pre-migration backup and one added after it. */
function databaseWithBackup(): { path: string; dir: string; rootPage: number; pageSize: number } {
  const dir = tempDir();
  const path = join(dir, 'library.db');
  const clock = fakeClock();
  const v1 = unwrap(openDatabase({ path, targetVersion: 1, clock: clock.now }));
  addSetting(v1, 'In the backup');
  v1.close();
  clock.advance(60_000);
  const db = unwrap(openDatabase({ path, clock: clock.now })); // backs up, then migrates to latest
  expect(db.opened.migration?.backup).not.toBeNull();
  addSetting(db, 'After the backup');
  const rootPage = Number(
    db.driver.prepare("SELECT rootpage FROM sqlite_schema WHERE name = 'settings'").get()?.rootpage,
  );
  const pageSize = Number(db.driver.prepare('PRAGMA page_size').get()?.page_size);
  db.close();
  expect(existsSync(`${path}-wal`)).toBe(false); // checkpointed on close: every byte is in the main file
  return { path, dir, rootPage, pageSize };
}

describe('corruption detection and restore', () => {
  it('restores from the backup when a table page is corrupt', () => {
    const { path, dir, rootPage, pageSize } = databaseWithBackup();
    flipBytes(path, (rootPage - 1) * pageSize, pageSize);

    const db = unwrap(openDatabase({ path }));
    expect(db.opened.recovery.needsAttention).toBe(true);
    const recovery = db.opened.recovery.restoredFromBackup;
    expect(recovery?.reason).toBe('corrupt');
    expect(recovery?.restoredFrom.reason).toBe(`pre-migrate-to-v${LIBRARY_MIGRATIONS.length}`);
    expect(existsSync(recovery!.quarantinedPath!)).toBe(true);
    // The backup was taken at v1, so opening migrated it forward again.
    expect(db.schemaVersion()).toBe(LIBRARY_MIGRATIONS.length);
    expect(db.opened.migration?.from).toBe(1);
    // Data from before the backup is back; what came after it is in the quarantined file only.
    expect(settingNames(db)).toEqual(['In the backup']);
    expect(db.driver.prepare('PRAGMA quick_check').get()?.quick_check).toBe('ok');
    db.close();
    expect(readdirSync(dir).some((name) => name.startsWith('library.db.corrupt-'))).toBe(true);
  });

  it('restores when the file header is corrupt (not a database)', () => {
    const { path } = databaseWithBackup();
    flipBytes(path, 0, 16);
    const db = unwrap(openDatabase({ path }));
    expect(db.opened.recovery.restoredFromBackup?.detail).toMatch(/not a database/);
    expect(settingNames(db)).toEqual(['In the backup']);
    db.close();
  });

  it('skips a corrupt backup and uses the next healthy one', () => {
    const clock = fakeClock();
    const path = join(tempDir(), 'library.db');
    const db = unwrap(openDatabase({ path, clock: clock.now }));
    addSetting(db, 'Older');
    clock.advance(1000);
    const older = unwrap(db.backup('daily'));
    addSetting(db, 'Newer');
    clock.advance(1000);
    const newer = unwrap(db.backup('daily'));
    db.close();
    flipBytes(newer.path, 0, 16);
    flipBytes(path, 0, 16);

    const restored = unwrap(openDatabase({ path, clock: clock.now }));
    expect(restored.opened.recovery.restoredFromBackup?.restoredFrom.path).toBe(older.path);
    expect(settingNames(restored)).toEqual(['Older']);
    restored.close();
  });

  it('returns DatabaseCorrupt and leaves the file in place when no backup is healthy', () => {
    const path = join(tempDir(), 'library.db');
    unwrap(openDatabase({ path })).close(); // new database: no backup
    flipBytes(path, 0, 16);
    const result = openDatabase({ path });
    expect(!result.ok && DatabaseCorrupt.is(result.error)).toBe(true);
    expect(existsSync(path)).toBe(true);
    expect(existsSync(`${path}.restoring`)).toBe(false);
  });

  /** Review 2: a backup that couldn't be copied threw after the live file was moved aside. */
  it('skips a backup it cannot copy, and moves the live file only once a replacement is staged', () => {
    const clock = fakeClock();
    const path = join(tempDir(), 'library.db');
    const db = unwrap(openDatabase({ path, clock: clock.now }));
    addSetting(db, 'Older');
    clock.advance(1000);
    const older = unwrap(db.backup('daily'));
    clock.advance(1000);
    const newer = unwrap(db.backup('daily'));
    db.close();
    rmSync(newer.path);
    mkdirSync(newer.path); // copyFileSync throws on it
    flipBytes(path, 0, 16);

    const restored = unwrap(openDatabase({ path, clock: clock.now }));
    expect(restored.opened.recovery.restoredFromBackup?.restoredFrom.path).toBe(older.path);
    expect(settingNames(restored)).toEqual(['Older']);
    restored.close();
  });

  it('keeps the live file when no backup can be copied', () => {
    const { path, dir } = databaseWithBackup();
    for (const name of readdirSync(join(dir, 'backups'))) {
      rmSync(join(dir, 'backups', name));
      mkdirSync(join(dir, 'backups', name));
    }
    flipBytes(path, 0, 16);
    const result = openDatabase({ path });
    expect(!result.ok && DatabaseCorrupt.is(result.error)).toBe(true);
    expect(readdirSync(dir).sort()).toEqual(['backups', 'library.db']);
  });

  it('restores a missing database file from the newest healthy backup', () => {
    const { path, dir } = databaseWithBackup();
    rmSync(path);
    writeFileSync(`${path}-wal`, 'left over from a lost database');

    const db = unwrap(openDatabase({ path }));
    const restore = db.opened.recovery.restoredFromBackup;
    expect(restore).toMatchObject({ reason: 'missing', restoredFrom: { schemaVersion: 1 } });
    expect(db.opened.recovery.needsAttention).toBe(true);
    expect(db.opened.migration?.from).toBe(1); // not 0: the backup came back, then migrated
    expect(settingNames(db)).toEqual(['In the backup']);
    db.close();
    // The stray -wal was moved aside with the quarantine name rather than replayed into the backup.
    expect(readFileSync(`${restore!.quarantinedPath!}-wal`, 'utf8')).toBe('left over from a lost database');
    expect(readdirSync(dir).filter((name) => name.endsWith('.restoring'))).toEqual([]);
  });

  it('creates a new database when the file is missing and no backup is healthy', () => {
    const { path, dir } = databaseWithBackup();
    rmSync(path);
    const [backup] = readdirSync(join(dir, 'backups'));
    flipBytes(join(dir, 'backups', backup!), 0, 16);
    const db = unwrap(openDatabase({ path }));
    expect(db.opened.recovery.restoredFromBackup).toBeNull();
    expect(db.opened.migration?.from).toBe(0);
    expect(settingNames(db)).toEqual([]);
    db.close();
    expect(readdirSync(join(dir, 'backups'))).toEqual([backup]);
  });

  it("doesn't restore when asked to fail instead", () => {
    const { path, rootPage, pageSize } = databaseWithBackup();
    flipBytes(path, (rootPage - 1) * pageSize, pageSize);
    const result = openDatabase({ path, onCorruption: 'fail' });
    expect(!result.ok && DatabaseCorrupt.is(result.error)).toBe(true);
    if (!result.ok) expect(result.error.detail).toBeTruthy();
  });

  it('reports a non-corruption open failure as DatabaseOpenFailed', () => {
    const dir = tempDir();
    mkdirSync(join(dir, 'library.db')); // a directory where the file should be
    const result = openDatabase({ path: join(dir, 'library.db') });
    expect(!result.ok && DatabaseOpenFailed.is(result.error)).toBe(true);
  });
});

describe('backups', () => {
  it('keeps only the newest N', () => {
    const clock = fakeClock();
    const db = unwrap(
      openDatabase({ path: join(tempDir(), 'library.db'), backups: { keep: 2 }, clock: clock.now }),
    );
    const taken = [1, 2, 3, 4].map(() => {
      clock.advance(1000);
      return unwrap(db.backup('manual'));
    });
    expect(db.listBackups().map((b) => b.path)).toEqual([taken[3]!.path, taken[2]!.path]);
    expect(existsSync(taken[0]!.path)).toBe(false);
    db.close();
  });

  it("won't back up an in-memory database without a directory", () => {
    const db = unwrap(openDatabase({ path: ':memory:' }));
    const result = db.backup();
    expect(!result.ok && BackupFailed.is(result.error)).toBe(true);
    expect(db.listBackups()).toEqual([]);
    const dir = tempDir();
    const withDir = unwrap(openDatabase({ path: ':memory:', backups: { dir } }));
    expect(unwrap(withDir.backup()).path.startsWith(dir)).toBe(true);
    db.close();
    withDir.close();
  });

  it('names two backups in the same millisecond apart', () => {
    const clock = fakeClock();
    const db = unwrap(openDatabase({ path: join(tempDir(), 'library.db'), clock: clock.now }));
    const a = unwrap(db.backup('Manual Save!'));
    const b = unwrap(db.backup('manual-save'));
    expect(a.path).not.toBe(b.path);
    expect(a.reason).toBe('manual-save');
    expect(db.listBackups()).toHaveLength(2);
    db.close();
  });

  it('writes a backup that opens and passes its integrity check', () => {
    const db = unwrap(openDatabase({ path: join(tempDir(), 'library.db') }));
    addSetting(db, 'Kept');
    const backup = unwrap(db.backup());
    db.close();
    const copy = unwrap(openDatabase({ path: backup.path, backups: { dir: join(tempDir(), 'b') } }));
    expect(settingNames(copy)).toEqual(['Kept']);
    copy.close();
  });
});
