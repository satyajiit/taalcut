// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The library database read while the app runs: a second, read-only connection that waits out the app's writes.
 * Rows come back as SQLite gives them; callers check their shape.
 */
import { DatabaseSync } from 'node:sqlite';
import { libraryPath } from '../src/shared/library-path';

export function libraryRows(userData: string, sql: string, ...params: (string | number)[]): unknown[] {
  const db = new DatabaseSync(libraryPath(userData), { readOnly: true });
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    return db.prepare(sql).all(...params);
  } finally {
    db.close();
  }
}
