// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Exact filename and filename-stem lookup for `library.search`: when a query names clips directly
 * (e.g. twelve filenames like `"20261102_173212.mp4, 20261102_135548.mp4, ..."`), each clip holds
 * only its own 2–3 filename terms out of ~28 query terms, which would fall below `keywordCoverage`
 * (0.5) and be capped by FTS5's single-list limit. Matching `assets.original_filename` and stems
 * directly gives every named clip `similarity = 1` and places all of them at the top, interleaved
 * one shot per matched clip first so multi-shot clips never crowd out later filenames.
 */
import { searchTerms, type AssetId, type ShotId } from '@taalcut/core';
import type { LibraryDatabase } from '../db/database';

const EXT =
  'mp4|mov|m4v|mkv|avi|webm|mts|m2ts|3gp|mxf|jpg|jpeg|png|heic|heif|webp|tif|tiff|dng|gif|m4a|mp3|wav|aac|aif|aiff|flac|caf|ogg|opus';

const TOKEN_FILE_RE = new RegExp(
  `([^\\s,;|"'\`()[\\]{}<>/\\\\]+\\.(?:${EXT}))(?=$|[^\\p{L}\\p{N}_-])`,
  'giu',
);
const CHUNK_FILE_RE = new RegExp(`^([^/\\\\]{1,120}\\.(?:${EXT}))$`, 'iu');
const STEM_TOKEN_RE = /[\p{L}\p{N}][\p{L}\p{N}_-]{4,}/gu;
const BOUNDARY_CHAR_RE = /[\p{L}\p{N}_-]/u;

const quoted = (term: string) => `"${term.replace(/"/g, '""')}"`;

interface CandidateRow {
  readonly shot_id: ShotId;
  readonly asset_id: AssetId;
  readonly best_take: number;
  readonly idx: number;
  readonly file_name: string;
}

/** First index of `needle` in `haystack` bounded by non-identifier characters, or -1. */
function boundaryIndexOf(haystack: string, needle: string): number {
  if (!needle) return -1;
  let from = 0;
  while (from <= haystack.length - needle.length) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) return -1;
    const before = at > 0 ? haystack[at - 1]! : '';
    const after = at + needle.length < haystack.length ? haystack[at + needle.length]! : '';
    if ((!before || !BOUNDARY_CHAR_RE.test(before)) && (!after || !BOUNDARY_CHAR_RE.test(after))) {
      return at;
    }
    from = at + 1;
  }
  return -1;
}

function extractCandidates(lowerQuery: string): { files: string[]; stems: string[] } {
  const files = new Set<string>();
  const stems = new Set<string>();
  for (const match of lowerQuery.matchAll(TOKEN_FILE_RE)) {
    if (match[1]) files.add(match[1]);
  }
  for (const raw of lowerQuery.split(/[,;|\n\r"'`()[\]{}<>]+/)) {
    const trimmed = raw.trim();
    const chunk = CHUNK_FILE_RE.exec(trimmed);
    if (chunk?.[1]) files.add(chunk[1]);
  }
  for (const match of lowerQuery.matchAll(STEM_TOKEN_RE)) {
    const token = match[0];
    if (token && /[\d_-]/.test(token)) stems.add(token);
  }
  return { files: [...files], stems: [...stems] };
}

function ftsFileClause(candidates: readonly string[]): string | null {
  const clauses = new Set<string>();
  for (const candidate of candidates) {
    const stem = candidate.replace(/\.[^.]+$/, '');
    const terms = searchTerms(stem);
    const active = terms.length > 0 ? terms : searchTerms(candidate);
    if (active.length > 0) {
      clauses.add(`(${active.map((term) => `file_name:${quoted(term)}`).join(' AND ')})`);
    }
  }
  return clauses.size > 0 ? [...clauses].join(' OR ') : null;
}

/**
 * Shots whose asset's `original_filename` (with extension) or identifier stem (`>= 5` chars) appears
 * in `query`, ordered round-robin across matched assets in the order `query` mentions them.
 */
export function filenameShotMatches(db: LibraryDatabase, query: string): ShotId[] {
  const lowerQuery = query.normalize('NFC').toLowerCase();
  const { files, stems } = extractCandidates(lowerQuery);
  if (files.length === 0 && stems.length === 0) return [];

  const rowsByShot = new Map<ShotId, CandidateRow>();
  if (files.length > 0) {
    const exactRows = db.driver
      .prepare(
        `SELECT s.id AS shot_id, s.asset_id AS asset_id, s.best_take AS best_take,
                s.index_in_asset AS idx, a.original_filename AS file_name
           FROM assets a JOIN shots s ON s.asset_id = a.id
          WHERE lower(a.original_filename) IN (SELECT value FROM json_each(?))`,
      )
      .all(JSON.stringify(files)) as unknown as CandidateRow[];
    for (const row of exactRows) rowsByShot.set(row.shot_id, row);
  }

  const clause = ftsFileClause([...files, ...stems]);
  if (clause) {
    const ftsRows = db.driver
      .prepare(
        `SELECT r.shot_id AS shot_id, s.asset_id AS asset_id, s.best_take AS best_take,
                s.index_in_asset AS idx, a.original_filename AS file_name
           FROM shot_fts
           JOIN shot_search_rows r ON r.rowid = shot_fts.rowid
           JOIN shots s ON s.id = r.shot_id
           JOIN assets a ON a.id = s.asset_id
          WHERE shot_fts MATCH ?`,
      )
      .all(clause) as unknown as CandidateRow[];
    for (const row of ftsRows) rowsByShot.set(row.shot_id, row);
  }
  if (rowsByShot.size === 0) return [];

  const byAsset = new Map<AssetId, { pos: number; shots: CandidateRow[] }>();
  for (const row of rowsByShot.values()) {
    const fullName = String(row.file_name).normalize('NFC').toLowerCase();
    const stem = fullName.replace(/\.[^.]+$/, '');
    const fullPos =
      fullName.includes('.') && fullName.length >= 3 ? boundaryIndexOf(lowerQuery, fullName) : -1;
    const stemPos = stem.length >= 5 && /[\d_-]/.test(stem) ? boundaryIndexOf(lowerQuery, stem) : -1;
    const positions = [fullPos, stemPos].filter((p) => p >= 0);
    if (positions.length === 0) continue;
    const pos = Math.min(...positions);
    const entry = byAsset.get(row.asset_id);
    if (entry) {
      entry.pos = Math.min(entry.pos, pos);
      entry.shots.push(row);
    } else {
      byAsset.set(row.asset_id, { pos, shots: [row] });
    }
  }
  if (byAsset.size === 0) return [];

  const orderedAssets = [...byAsset.entries()]
    .sort(([idA, a], [idB, b]) => a.pos - b.pos || idA.localeCompare(idB))
    .map(([, entry]) =>
      entry.shots.sort(
        (a, b) => b.best_take - a.best_take || a.idx - b.idx || a.shot_id.localeCompare(b.shot_id),
      ),
    );

  const interleaved: ShotId[] = [];
  const maxShots = Math.max(...orderedAssets.map((list) => list.length));
  for (let round = 0; round < maxShots; round++) {
    for (const list of orderedAssets) {
      const shot = list[round];
      if (shot) interleaved.push(shot.shot_id);
    }
  }
  return interleaved;
}
