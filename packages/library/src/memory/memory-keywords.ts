// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Keyword matches over `memory_fts` (migration 30). Library search's `ftsQuery` with `prefix` makes the expression:
 * the terms as library search splits them (letters, digits and marks, stopwords dropped), each a quoted prefix,
 * OR-ed: "whi" finds "whip" as the person types, and an item holding more of the terms ranks higher (bm25). User
 * text never reaches FTS5 syntax unquoted.
 */
import type { MemoryId } from '@taalcut/core';
import type { LibraryDatabase } from '../db/database';
import { ftsQuery } from '../search/fts';

/** More than any memory holds; bounds the scan. */
const MAX_MATCHES = 5000;

/** Each matching item's place in bm25 order (0 is the best); empty when nothing matches or the text has no terms. */
export function memoryKeywordRanks(db: LibraryDatabase, text: string): Map<MemoryId, number> {
  const match = ftsQuery(text, { prefix: true });
  if (match === null) return new Map();
  const rows = db.driver
    .prepare('SELECT memory_id FROM memory_fts WHERE memory_fts MATCH ? ORDER BY rank LIMIT ?')
    .all(match, MAX_MATCHES);
  return new Map(rows.map((row, index) => [row.memory_id as MemoryId, index]));
}
