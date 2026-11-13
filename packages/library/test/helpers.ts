// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unwrap } from '@taalcut/core';
import { afterEach } from 'vitest';
import { openDatabase, type LibraryDatabase, type OpenDatabaseOptions } from '../src/index';

const cleanups: (() => void)[] = [];

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!();
});

/** A fresh temporary directory, removed after the test. */
export function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'taalcut-library-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A manual clock: starts at 2026-10-12T00:00:00Z and moves only when told. */
export function fakeClock(start = Date.UTC(2026, 9, 12)): {
  now: () => number;
  advance: (ms: number) => void;
} {
  let t = start;
  return { now: () => t, advance: (ms) => (t += ms) };
}

/** Opens a migrated database in a temp dir (or memory), closed after the test. */
export function openTestDb(options: Partial<OpenDatabaseOptions> & { file?: boolean } = {}): LibraryDatabase {
  const path = options.path ?? (options.file === false ? ':memory:' : join(tempDir(), 'library.db'));
  const db = unwrap(openDatabase({ ...options, path }));
  cleanups.push(() => db.close());
  return db;
}
