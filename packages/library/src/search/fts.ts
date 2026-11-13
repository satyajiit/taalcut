// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Keyword search over `shot_fts` (migration 13). The user's text never
 * reaches FTS5 syntax: it is split into terms by core's `searchTerms`
 * (letters, digits and marks, so a Devanagari word stays whole, a short
 * stopword list per v1 language dropped), and each term becomes a quoted
 * string, OR-ed. Ranked by
 * bm25 with the description and on-screen text weighted up and file names
 * down. Snippets come back as plain text plus highlight ranges, marked with
 * private-use characters inside SQLite and never as markup.
 *
 * Since LIB1-FIND a term that means one of core's fixed actions also matches it as stored ("dance", "नाचते" and
 * "bailando" match "dancing"; "khana banate" matches "cooking"), and filler words of romanised and Devanagari
 * Hindi ("wale", "हुए") don't count against a shot's share of the query's terms.
 */
import { searchTerms, type ShotId } from '@taalcut/core';
import type { LibraryDatabase } from '../db/database';
import { actionsOfWord } from './action-words';
import { filenameShotMatches } from './filename-matches';
import type { ListMatch } from './fusion/lists';

/** Column weights: description, labels, on-screen text, transcript, file name, actions (LIB1-FIND). */
const BM25 = 'bm25(1.0, 0.8, 1.2, 1.0, 0.5, 1.0)';
/** Marks a highlight inside SQLite's snippet(); removed before the text leaves. */
const OPEN = '';
const CLOSE = '';

/** A term as an FTS5 string: user text never reaches FTS syntax unquoted. */
const quoted = (term: string) => `"${term.replace(/"/g, '""')}"`;

/** Words of Hindi, Devanagari or romanised, that join a query ("dance wale shots") but say nothing on their own. */
const FILLER = new Set(
  'हुए हुआ हुई वाले वाला वाली वाले wale wala wali waale waala waali hue hua pe par mein me ka ki ke hai hain'
    .normalize('NFC')
    .split(' '),
);

/**
 * The query's terms, each as the FTS5 strings that count as it: the term, and the stored actions it means alone or
 * in a run of up to three ("playing music" is a phrase). `counts`: whether it counts toward a shot's share.
 */
function termGroups(text: string): { readonly match: string; readonly counts: boolean }[] {
  const terms = searchTerms(text);
  const alternatives = terms.map((term) => new Set([quoted(term)]));
  for (let i = 0; i < terms.length; i++)
    for (const span of [1, 2, 3]) {
      if (i + span > terms.length) break;
      for (const action of actionsOfWord(terms.slice(i, i + span).join(' ')))
        for (let j = i; j < i + span; j++) alternatives[j]!.add(quoted(action));
    }
  const groups = alternatives.map((set, i) => ({
    match: set.size === 1 ? [...set][0]! : `(${[...set].join(' OR ')})`,
    counts: !FILLER.has(terms[i]!),
  }));
  return groups.some((group) => group.counts) ? groups : groups.map((group) => ({ ...group, counts: true }));
}

/**
 * An FTS5 MATCH expression for the text, or null when it has no terms. Every term is a quoted string; with
 * `prefix`, a quoted prefix ("whi" finds "whip" as the person types: memory search, LRN1-MEM).
 */
export function ftsQuery(text: string, options: { readonly prefix?: boolean } = {}): string | null {
  if (options.prefix) {
    const terms = searchTerms(text);
    return terms.length === 0 ? null : terms.map((word) => `${quoted(word)}*`).join(' OR ');
  }
  const groups = termGroups(text);
  return groups.length === 0 ? null : groups.map((group) => group.match).join(' OR ');
}

/**
 * The best `limit` shots for the query by bm25, best first, each with the share of the query's terms it holds
 * (its `similarity`, 0..1): the terms are OR-ed, so a shot holding one common word of a long query is a hit too,
 * and fusion can tell it from one holding them all. One FTS lookup per term, over the hits only.
 */
export function keywordList(db: LibraryDatabase, query: string, limit: number): ListMatch[] {
  const exact = filenameShotMatches(db, query);
  const groups = termGroups(query);
  if (groups.length === 0) return exact.slice(0, limit).map((shotId) => ({ shotId, similarity: 1 }));
  const counted = groups.filter((group) => group.counts);
  const rows = db.driver
    .prepare(
      // `rank MATCH` sets the ranking for this query, so FTS5 sorts by it itself (its ORDER BY rank
      // optimisation) instead of SQLite sorting every match by a bm25() column.
      `SELECT f.rowid AS row, r.shot_id AS shot_id FROM (
         SELECT rowid, rank FROM shot_fts WHERE shot_fts MATCH ? AND rank MATCH '${BM25}' ORDER BY rank LIMIT ?
       ) f JOIN shot_search_rows r ON r.rowid = f.rowid ORDER BY f.rank`,
    )
    .all(groups.map((group) => group.match).join(' OR '), limit);
  if (rows.length === 0) return exact.slice(0, limit).map((shotId) => ({ shotId, similarity: 1 }));
  const held = new Map<number, number>();
  if (groups.length > 1) {
    const within = JSON.stringify(rows.map((row) => Number(row.row)));
    const holding = db.driver.prepare(
      'SELECT rowid AS row FROM shot_fts WHERE shot_fts MATCH ? AND rowid IN (SELECT value FROM json_each(?))',
    );
    for (const group of counted)
      for (const { row } of holding.all(group.match, within))
        held.set(Number(row), (held.get(Number(row)) ?? 0) + 1);
  }
  const ftsMatches = rows.map((row) => ({
    shotId: row.shot_id as ShotId,
    similarity: groups.length > 1 ? (held.get(Number(row.row)) ?? 0) / counted.length : 1,
  }));
  if (exact.length === 0) return ftsMatches;
  const seen = new Set<ShotId>(exact);
  return [
    ...exact.map((shotId) => ({ shotId, similarity: 1 })),
    ...ftsMatches.filter((m) => !seen.has(m.shotId)),
  ].slice(0, Math.max(limit, exact.length));
}

/** The best `limit` shots for the query, best first. */
export function keywordMatches(db: LibraryDatabase, query: string, limit: number): ShotId[] {
  return keywordList(db, query, limit).map((match) => match.shotId);
}

export interface Snippet {
  readonly field: 'transcript' | 'onScreenText' | 'description';
  readonly text: string;
  /** [start, end) UTF-16 offsets into `text`. */
  readonly highlights: [number, number][];
}

const MAX_TEXT = 400;
const MAX_HIGHLIGHTS = 20;

/** Plain text and highlight ranges from a snippet marked with OPEN/CLOSE. Stray markers are dropped. */
export function parseSnippet(marked: string): { text: string; highlights: [number, number][] } {
  let text = '';
  let start: number | null = null;
  const highlights: [number, number][] = [];
  for (const char of marked) {
    if (char === OPEN) start = text.length;
    else if (char === CLOSE) {
      if (start !== null && text.length > start) highlights.push([start, text.length]);
      start = null;
    } else text += char;
  }
  if (text.length > MAX_TEXT) text = text.slice(0, MAX_TEXT - 1) + '…';
  return {
    text,
    highlights: highlights
      .filter(([s]) => s < text.length)
      .map(([s, e]): [number, number] => [s, Math.min(e, text.length)])
      .slice(0, MAX_HIGHLIGHTS),
  };
}

/** shot_fts columns a snippet may come from, in order of preference on a tie. */
const SNIPPET_FIELDS = [
  { field: 'description', column: 0 },
  { field: 'transcript', column: 3 },
  { field: 'onScreenText', column: 2 },
] as const;

/** The best snippet per shot (the field with the most highlighted terms), for shots the query matched. */
export function snippets(
  db: LibraryDatabase,
  query: string,
  shotIds: readonly ShotId[],
): Map<ShotId, Snippet> {
  const match = ftsQuery(query);
  const result = new Map<ShotId, Snippet>();
  if (!match || shotIds.length === 0) return result;
  const columns = SNIPPET_FIELDS.map(
    ({ column }) => `snippet(shot_fts, ${column}, '${OPEN}', '${CLOSE}', '…', 16) AS c${column}`,
  ).join(', ');
  const rows = db.driver
    .prepare(
      `SELECT r.shot_id AS shot_id, ${columns} FROM shot_fts JOIN shot_search_rows r ON r.rowid = shot_fts.rowid
       WHERE shot_fts MATCH ? AND r.shot_id IN (SELECT value FROM json_each(?))`,
    )
    .all(match, JSON.stringify(shotIds));
  for (const row of rows) {
    let best: Snippet | undefined;
    for (const { field, column } of SNIPPET_FIELDS) {
      const parsed = parseSnippet(String(row[`c${column}`] ?? ''));
      if (parsed.highlights.length > (best?.highlights.length ?? 0)) best = { field, ...parsed };
    }
    if (best) result.set(row.shot_id as ShotId, best);
  }
  return result;
}
