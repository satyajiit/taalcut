// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LIB1-OEM: the time zone a clip was shot in.
 *
 * - A bare `Z` capture time stored `capture_offset_min = 0`: an MP4's `creation_time` is the UTC instant and names
 *   no zone, so a Samsung clip shot anywhere read as shot in UTC. Those offsets become unknown (null), and
 *   `capture_offset_min` is from now on only the zone the clip's own file names. The real zone comes when the clip is
 *   analysed again and normalise reads the phone's own offset.
 * - `asset_borrowed_offsets`: a clip without a zone of its own takes the zone of the nearest clip in time (within
 *   12 hours) from a source they share that has one (repositories/capture-offsets.ts), with that clip as its lender.
 *   This fills it for the library as it is.
 *
 * Down drops the table; the offsets it cleared stay cleared (they were never the file's).
 */
import type { Migration } from './types';

const WINDOW_MS = 12 * 60 * 60 * 1000;

const up = `
CREATE TABLE asset_borrowed_offsets (
  asset_id TEXT PRIMARY KEY NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  offset_min INTEGER NOT NULL CHECK (offset_min BETWEEN -720 AND 840),
  lender_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE
) STRICT;
CREATE INDEX asset_borrowed_offsets_lender_idx ON asset_borrowed_offsets(lender_id);

UPDATE assets SET capture_offset_min = NULL
  WHERE capture_offset_min IS NOT NULL AND facts IS NOT NULL
    AND json_extract(facts, '$.captureOffsetMin') IS NULL
    AND json_extract(facts, '$.captureTime') LIKE '%Z';

INSERT INTO asset_borrowed_offsets (asset_id, offset_min, lender_id)
SELECT asset_id, offset_min, lender_id FROM (
  SELECT a.id AS asset_id, n.capture_offset_min AS offset_min, n.id AS lender_id,
    ROW_NUMBER() OVER (PARTITION BY a.id ORDER BY abs(n.capture_time - a.capture_time), n.id) AS nearest
  FROM assets a JOIN assets n ON n.id != a.id AND n.capture_offset_min IS NOT NULL
    AND n.capture_time IS NOT NULL AND a.capture_time IS NOT NULL
    AND n.capture_time BETWEEN a.capture_time - ${WINDOW_MS} AND a.capture_time + ${WINDOW_MS}
    AND EXISTS (SELECT 1 FROM asset_locations ln JOIN asset_locations la ON la.source_id = ln.source_id
      WHERE ln.asset_id = n.id AND la.asset_id = a.id)
  WHERE a.capture_offset_min IS NULL
) WHERE nearest = 1;
`;

const down = `DROP TABLE asset_borrowed_offsets;`;

export const captureOffsets: Migration = { version: 33, name: 'capture_offsets', up, down };
