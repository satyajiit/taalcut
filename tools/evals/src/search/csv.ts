// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { join } from 'node:path';
import { parseCsv } from '../csv';
import { writeJson } from '../files';
import { parseSearchQuery, searchShotSchema, type SearchQueryLabel } from './schema';

export const SEARCH_CSV_COLUMNS = [
  'queryId',
  'language',
  'library',
  'text',
  'asset',
  'startFrame',
  'endFrame',
  'synthetic',
] as const;

/** One row per relevant shot. Empty frame cells mean the whole asset. */
export function queriesFromSearchCsv(csv: string): SearchQueryLabel[] {
  const table = parseCsv(csv).filter((row) => row.some((cell) => cell.trim() !== ''));
  const header = table[0];
  if (header === undefined) throw new Error('Search sheet is empty');
  const index = new Map(header.map((name, at) => [name.trim(), at]));
  for (const column of SEARCH_CSV_COLUMNS) {
    if (!index.has(column)) throw new Error(`Search sheet is missing the ${column} column`);
  }
  const cell = (row: string[], column: string): string => row[index.get(column) ?? -1]?.trim() ?? '';
  const byId = new Map<string, SearchQueryLabel>();
  for (let rowIndex = 1; rowIndex < table.length; rowIndex += 1) {
    const row = table[rowIndex] ?? [];
    const queryId = cell(row, 'queryId');
    const asset = cell(row, 'asset');
    const start = cell(row, 'startFrame');
    const end = cell(row, 'endFrame');
    if ((start === '') !== (end === '')) {
      throw new Error(`Row ${rowIndex + 1} (${queryId}) needs both frame cells, or neither`);
    }
    const shotParsed = searchShotSchema.safeParse(
      start === '' ? { asset } : { asset, range: { startFrame: Number(start), endFrame: Number(end) } },
    );
    if (!shotParsed.success) throw new Error(`Row ${rowIndex + 1} (${queryId}) has an invalid shot`);
    const existing = byId.get(queryId);
    if (existing === undefined) {
      byId.set(
        queryId,
        parseSearchQuery(
          {
            queryId,
            language: cell(row, 'language'),
            library: cell(row, 'library'),
            text: cell(row, 'text'),
            relevant: [shotParsed.data],
            synthetic: cell(row, 'synthetic') === 'true',
          },
          `row ${rowIndex + 1}`,
        ),
      );
    } else {
      existing.relevant.push(shotParsed.data);
    }
  }
  if (byId.size === 0) throw new Error('Search sheet has no rows');
  return [...byId.values()];
}

/** Writes `outDir/<library>.json`, an array of queries. */
export function writeSearchLabels(queries: readonly SearchQueryLabel[], outDir: string): string[] {
  const byLibrary = new Map<string, SearchQueryLabel[]>();
  for (const query of queries) {
    const list = byLibrary.get(query.library) ?? [];
    list.push(query);
    byLibrary.set(query.library, list);
  }
  const written: string[] = [];
  for (const [library, list] of [...byLibrary.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const path = join(outDir, `${library}.json`);
    writeJson(path, list);
    written.push(path);
  }
  return written;
}
