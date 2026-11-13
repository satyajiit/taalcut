// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Migration 33 (LIB1-OEM): where a clip's UTC offset came from. A bare `Z` capture time stored offset 0, so the
 * Samsung clips read as shot in UTC: those offsets become unknown. An offset a file named stays,
 * and a clip without one borrows the nearest one from its source within 12 hours. Down drops the borrowed offsets.
 */
import { unwrap, type AssetId } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import type { LibraryDatabase } from '../src/index';
import { openTestDb } from './helpers';
import { addAssets } from './indexing/harness';

const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 2, 14, 9, 30, 0);

function stored(db: LibraryDatabase, id: AssetId, captureTime: string, at: number, offset: number | null) {
  const facts = JSON.stringify({ version: 1, captureTime });
  db.driver
    .prepare(`UPDATE assets SET facts = ?, capture_time = ?, capture_offset_min = ? WHERE id = ?`)
    .run(facts, at, offset, id);
}

const offsets = (db: LibraryDatabase, id: AssetId) =>
  db.driver
    .prepare(
      `SELECT a.capture_offset_min AS own, b.offset_min AS borrowed FROM assets a
       LEFT JOIN asset_borrowed_offsets b ON b.asset_id = a.id WHERE a.id = ?`,
    )
    .get(id);

describe('migration 33: capture offsets', () => {
  it('clears the offsets a Z time stored, keeps the real ones, and lends them to neighbours', () => {
    // The repositories write today's columns, so the clips are made first and the library goes back to 32.
    const db = openTestDb();
    const { assets } = addAssets(db, ['video', 'video', 'video', 'video']);
    const [phone, apple, nearby, far] = assets as [AssetId, AssetId, AssetId, AssetId];
    const other = (addAssets(db, ['video'], { sourceName: 'Mac' }).assets as [AssetId])[0];
    unwrap(db.migrateTo(32));
    stored(db, phone, '2026-03-14T09:30:00.000000Z', T0, 0);
    stored(db, apple, '2026-03-14T15:30:00+05:30', T0 + 3 * HOUR, 330);
    stored(db, nearby, '2026-03-14T07:15:00.000000Z', T0 - 2 * HOUR, 0);
    stored(db, far, '2026-03-16T06:30:00.000000Z', T0 + 45 * HOUR, 0);
    stored(db, other, '2026-03-14T09:00:00.000000Z', T0 - HOUR, 0);

    unwrap(db.migrateTo(33));
    // The Samsung clip's Z offset was never its zone; the Apple clip lends its real one to both of them.
    expect(offsets(db, apple)).toEqual({ own: 330, borrowed: null });
    expect(offsets(db, phone)).toEqual({ own: null, borrowed: 330 });
    expect(offsets(db, nearby)).toEqual({ own: null, borrowed: 330 });
    expect(offsets(db, far)).toEqual({ own: null, borrowed: null });
    expect(offsets(db, other)).toEqual({ own: null, borrowed: null });

    unwrap(db.migrateTo(32));
    const tables = db.driver
      .prepare(`SELECT name FROM sqlite_master WHERE name = 'asset_borrowed_offsets'`)
      .all();
    expect(tables).toEqual([]);
    expect(db.driver.prepare(`SELECT capture_offset_min AS own FROM assets WHERE id = ?`).get(apple)).toEqual(
      {
        own: 330,
      },
    );
  });
});
