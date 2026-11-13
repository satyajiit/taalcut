// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Migration 28 (UX1-IMPORT): a Wi-Fi import source named "K" by Chrome's reduced User-Agent is renamed "Android
 * phone". Only that row's name and device label change: a source the person renamed, a folder or USB import called
 * K and every other column stay as they were. Forward-only: down leaves the name.
 */
import { unwrap } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import type { LibraryDatabase } from '../src/index';
import { openTestDb } from './helpers';

const insert = (db: LibraryDatabase, id: string, kind: string, name: string, label: string | null) =>
  db.driver
    .prepare(
      `INSERT INTO sources (id, kind, display_name, root_path, status, created_at, updated_at, transfer_session_id,
         device_label)
       VALUES (?, ?, ?, ?, 'online', 1, 2, ?, ?)`,
    )
    .run(id, kind, name, `/imports/${id}`, kind === 'watched_folder' ? null : `session-${id}`, label);

const rows = (db: LibraryDatabase) => db.driver.prepare('SELECT * FROM sources ORDER BY id').all();

describe('migration 28: reduced user-agent source names', () => {
  it('renames only a Wi-Fi import still called K, and goes down and up again', () => {
    const db = openTestDb({ targetVersion: 27 });
    insert(db, 'a-phone', 'wifi_import', 'K', 'K');
    insert(db, 'b-renamed', 'wifi_import', 'Goa trip', 'K');
    insert(db, 'c-folder', 'watched_folder', 'K', null);
    insert(db, 'd-usb', 'usb_import', 'K', 'K');
    insert(db, 'e-pixel', 'wifi_import', 'Pixel 8', 'Pixel 8');
    const before = rows(db);

    unwrap(db.migrateTo(28));
    const after = rows(db);
    const renamed = before.map((row) =>
      row.id === 'a-phone' ? { ...row, display_name: 'Android phone', device_label: 'Android phone' } : row,
    );
    expect(after).toEqual(renamed);

    // Forward-only: down keeps the new name, and up again changes nothing more.
    unwrap(db.migrateTo(27));
    expect(rows(db)).toEqual(renamed);
    unwrap(db.migrateTo(28));
    expect(rows(db)).toEqual(renamed);
  });
});
