// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The time zone a clip was shot in (LIB1-OEM). `assets.capture_offset_min` is the zone the clip's own file names.
 * A clip whose file names none (an MP4 with only a UTC creation time, like the Sample Cam app's) borrows the zone of
 * the nearest clip in time, within 12 hours, from a source they share, that has one of its own: the same phone on
 * the same trip, very likely in the same zone, and shown as "probably". Borrowed zones live in
 * `asset_borrowed_offsets` (migration 33) with the clip they came from, and are worked out again whenever a clip's
 * facts are stored, so the order clips are analysed in doesn't matter.
 */
import { captureOffsetSchema, type AssetId, type CaptureOffset } from '@taalcut/core';
import type { LibraryDatabase } from '../db/database';

/** How far apart in time a clip may be to lend its zone: half a day either way. */
export const NEARBY_OFFSET_WINDOW_MS = 12 * 60 * 60 * 1000;

/** Enough for a day of burst shots; past it the rest keep what they had until their own facts are stored. */
const MAX_NEIGHBOURS = 2000;

/** `n` can lend its zone to `a`: its file names one, it is within the window, and they share a source. */
const LENDS = `n.id != a.id AND n.capture_offset_min IS NOT NULL AND n.capture_time IS NOT NULL
  AND a.capture_time IS NOT NULL
  AND n.capture_time BETWEEN a.capture_time - ${NEARBY_OFFSET_WINDOW_MS} AND a.capture_time + ${NEARBY_OFFSET_WINDOW_MS}
  AND EXISTS (SELECT 1 FROM asset_locations ln JOIN asset_locations la ON la.source_id = ln.source_id
    WHERE ln.asset_id = n.id AND la.asset_id = a.id)`;

const FORGET = `DELETE FROM asset_borrowed_offsets WHERE asset_id = ?`;

const BORROW = `INSERT INTO asset_borrowed_offsets (asset_id, offset_min, lender_id)
  SELECT a.id, n.capture_offset_min, n.id FROM assets a JOIN assets n ON ${LENDS}
  WHERE a.id = ? AND a.capture_offset_min IS NULL
  ORDER BY abs(n.capture_time - a.capture_time), n.id LIMIT 1`;

/** Clips without a zone of their own near `id` in time from a source it is in, and those it lent its zone to. */
const NEIGHBOURS = `SELECT DISTINCT n.id AS id FROM assets a
  JOIN asset_locations la ON la.asset_id = a.id
  JOIN asset_locations ln ON ln.source_id = la.source_id
  JOIN assets n ON n.id = ln.asset_id
  WHERE a.id = ? AND n.id != a.id AND a.capture_time IS NOT NULL AND n.capture_offset_min IS NULL
    AND n.capture_time BETWEEN a.capture_time - ${NEARBY_OFFSET_WINDOW_MS} AND a.capture_time + ${NEARBY_OFFSET_WINDOW_MS}
  UNION SELECT asset_id AS id FROM asset_borrowed_offsets WHERE lender_id = ?
  LIMIT ${MAX_NEIGHBOURS}`;

/**
 * After `id`'s facts were stored, inside that transaction: `id` borrows a zone if it has none of its own, and the
 * clips around it, or that borrowed from it, borrow again (it may now lend one, or have stopped lending one).
 */
export function settleCaptureOffsets(db: LibraryDatabase, id: AssetId): void {
  const forget = db.driver.prepare(FORGET);
  const borrow = db.driver.prepare(BORROW);
  const settle = (assetId: string) => {
    forget.run(assetId);
    borrow.run(assetId);
  };
  settle(id);
  for (const row of db.driver.prepare(NEIGHBOURS).all(id, id) as { id: string }[]) settle(row.id);
}

/** The summary's `captureOffset` for each row: its file's, else a borrowed one, else null. */
export function captureOffsetsOf(
  db: LibraryDatabase,
  rows: readonly { readonly id: string; readonly captureOffsetMin: number | null }[],
): Map<string, CaptureOffset | null> {
  const need = rows.filter((row) => row.captureOffsetMin === null).map((row) => row.id);
  const borrowed = new Map<string, number>();
  if (need.length > 0) {
    const found = db.driver
      .prepare(
        `SELECT asset_id AS id, offset_min AS minutes FROM asset_borrowed_offsets
         WHERE asset_id IN (SELECT value FROM json_each(?))`,
      )
      .all(JSON.stringify(need)) as { id: string; minutes: number }[];
    for (const row of found) borrowed.set(row.id, row.minutes);
  }
  return new Map(
    rows.map((row) => {
      const minutes = row.captureOffsetMin ?? borrowed.get(row.id);
      if (minutes === undefined) return [row.id, null];
      const parsed = captureOffsetSchema.safeParse({
        minutes,
        from: row.captureOffsetMin === null ? 'nearby' : 'file',
      });
      return [row.id, parsed.success ? parsed.data : null];
    }),
  );
}
