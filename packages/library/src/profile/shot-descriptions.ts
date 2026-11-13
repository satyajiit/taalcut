// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What indexing's model said each shot shows (the stored description), by shot id, for the Librarian's rerank
 * (timeline SPEC "Rerank", FIX-LIBRARIAN): casting's profiles carry no text, and the rerank reads these words
 * instead of sending frames anywhere. Model output from the user's media: the timeline tool marks it untrusted.
 */
import type { LibraryDatabase } from '../db/database';

/** Shots without a description are left out, as are ids that aren't shots. */
export function shotDescriptions(db: LibraryDatabase, shotIds: readonly string[]): Map<string, string> {
  if (shotIds.length === 0) return new Map();
  const rows = db.driver
    .prepare(
      `SELECT id, description FROM shots
       WHERE id IN (SELECT value FROM json_each(?)) AND description IS NOT NULL AND trim(description) != ''`,
    )
    .all(JSON.stringify(shotIds));
  return new Map(rows.map((row) => [String(row.id), String(row.description)]));
}
