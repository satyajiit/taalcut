// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Migration 23 (usage and imports, G8 and P3-B4) with data: a call logged before it reads back with no billed
 * units, the billed and USB-record checks hold, a USB record goes with its asset, and down then up again
 * keeps the calls.
 */
import { newId, unwrap } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { type LibraryDatabase } from '../src/index';
import { cloudCall } from './fixtures/records';
import { openTestDb } from './helpers';

const run = (db: LibraryDatabase, text: string, ...params: (string | number | null)[]) =>
  db.driver.prepare(text).run(...params);

const usbRow = (db: LibraryDatabase, assetId: string, bridge: string, sha256: string) =>
  run(
    db,
    `INSERT INTO usb_imports (device_key, item_key, asset_id, run_id, bridge, sha256, imported_at)
     VALUES ('ABCDEFGHIJKLMNOP', ?, ?, 'run', ?, ?, 1)`,
    newId<'Asset'>(),
    assetId,
    bridge,
    sha256,
  );

describe('migration 23: usage and imports', () => {
  it('keeps earlier calls, holds its checks, and goes down and up again', () => {
    const db = openTestDb({ targetVersion: 22 });
    const before = cloudCall();
    run(
      db,
      `INSERT INTO cloud_calls (id, module, provider, model, latency_ms, outcome, started_at)
       VALUES (?, 'agent', 'openai', 'gpt-5', 10, 'ok', 1)`,
      before.id,
    );
    unwrap(db.migrateTo(23));
    // Assert the schema at this historical version; the current repository also selects newer columns.
    expect(db.driver.prepare('SELECT billed_unit, billed_quantity FROM cloud_calls').get()).toEqual({
      billed_unit: null,
      billed_quantity: null,
    });

    expect(() =>
      run(db, `UPDATE cloud_calls SET billed_unit = 'parsecs', billed_quantity = 1 WHERE id = ?`, before.id),
    ).toThrow();
    expect(() => run(db, `UPDATE cloud_calls SET billed_quantity = -1 WHERE id = ?`, before.id)).toThrow();

    const assetId = newId<'Asset'>();
    run(
      db,
      `INSERT INTO assets (id, kind, size_bytes, original_filename, availability, created_at, updated_at)
       VALUES (?, 'video', 10, 'clip.mov', 'online', 1, 1)`,
      assetId,
    );
    expect(() => usbRow(db, assetId, 'bluetooth', 'a'.repeat(64))).toThrow();
    expect(() => usbRow(db, assetId, 'mtp', 'short')).toThrow();
    usbRow(db, assetId, 'mtp', 'a'.repeat(64));
    run(db, 'DELETE FROM assets WHERE id = ?', assetId);
    expect(db.driver.prepare('SELECT count(*) AS n FROM usb_imports').get()).toEqual({ n: 0 });

    unwrap(db.migrateTo(22));
    expect(
      db.driver.prepare("SELECT name FROM sqlite_schema WHERE name = 'usb_imports'").get(),
    ).toBeUndefined();
    unwrap(db.migrateTo(23));
    expect(db.driver.prepare('SELECT id FROM cloud_calls').all()).toEqual([{ id: before.id }]);
  });
});
