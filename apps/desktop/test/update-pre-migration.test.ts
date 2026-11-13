// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Which launch asks the library for a pre-migration snapshot (P3-B9): only a staged update's new version, for the
 * library the pending file names; then the library writes it where the update guard looks for it.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unwrap } from '@taalcut/core';
import { LIBRARY_MIGRATIONS, openDatabase } from '@taalcut/library';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { libraryPath } from '../src/shared/library-path';
import { preMigrationSnapshotFor } from '../src/main/update/pre-migration';
import { updatePaths, writeUpdateFile, type PendingUpdate } from '../src/main/update/update-files';

let userData: string;

const pending = (overrides: Partial<PendingUpdate> = {}): PendingUpdate => ({
  v: 1,
  from: '1.3.0-beta.1',
  to: '1.3.0-beta.2',
  appPath: '/Applications/Taalcut.app',
  rollbackApp: `${userData}/updates/rollback/Taalcut-1.3.0-beta.1.app`,
  library: libraryPath(userData),
  at: 1_000,
  launchAttempts: 1,
  ...overrides,
});

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'taalcut-premigrate-'));
});
afterEach(() => rmSync(userData, { recursive: true, force: true }));

describe('pre-migration snapshot on an update’s launch', () => {
  it('names the update’s versions when this launch is its new version', () => {
    const paths = updatePaths(userData);
    unwrap(writeUpdateFile(paths.pending, pending()));
    expect(preMigrationSnapshotFor(paths, '1.3.0-beta.2', libraryPath(userData))).toEqual({
      from: '1.3.0-beta.1',
      to: '1.3.0-beta.2',
    });
  });

  it('takes none without a pending update, before it installed, for another library or a damaged file', () => {
    const paths = updatePaths(userData);
    expect(preMigrationSnapshotFor(paths, '1.3.0-beta.2', libraryPath(userData))).toBeUndefined();
    unwrap(writeUpdateFile(paths.pending, pending()));
    expect(preMigrationSnapshotFor(paths, '1.3.0-beta.1', libraryPath(userData))).toBeUndefined();
    expect(preMigrationSnapshotFor(paths, '1.3.0-beta.2', '/elsewhere/library.sqlite')).toBeUndefined();
    writeFileSync(paths.pending, '{"v":1');
    expect(preMigrationSnapshotFor(paths, '1.3.0-beta.2', libraryPath(userData))).toBeUndefined();
  });

  it('leaves the copy beside the library, where the guard restores it from', () => {
    const library = libraryPath(userData);
    mkdirSync(join(userData, 'catalog'), { recursive: true });
    const latest = LIBRARY_MIGRATIONS.length;
    unwrap(openDatabase({ path: library, targetVersion: latest - 1 })).close();
    const paths = updatePaths(userData);
    unwrap(writeUpdateFile(paths.pending, pending()));
    const versions = preMigrationSnapshotFor(paths, '1.3.0-beta.2', library);
    unwrap(openDatabase({ path: library, ...(versions ? { preMigrationSnapshot: versions } : {}) })).close();
    expect(existsSync(join(userData, 'catalog', 'pre-migrate-1.3.0-beta.1-1.3.0-beta.2.sqlite'))).toBe(true);
  });
});
