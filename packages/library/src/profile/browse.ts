// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The library grid (`library.browse`): filtered, sorted, keyset-paged asset
 * summaries. The cursor is the last row's sort key and id, so paging never
 * skips or repeats a row while assets arrive. "Captured" sorts by capture
 * time, or the time added when the file has none; unknown durations and
 * qualities sort as the smallest.
 */
import {
  err,
  ok,
  ValidationError,
  type AssetId,
  type AssetSummary,
  type LibraryFilters,
  type Result,
} from '@taalcut/core';
import { inArray } from 'drizzle-orm';
import type { LibraryDatabase } from '../db/database';
import type { SqlValue } from '../driver/types';
import { assets } from '../schema/library';
import { filterSql } from './filters';
import { assetSummaries } from './summaries';

export type LibrarySort = 'captured' | 'added' | 'duration' | 'quality';

export interface BrowseInput {
  readonly filters?: LibraryFilters;
  readonly sort?: LibrarySort;
  readonly direction?: 'asc' | 'desc';
  readonly cursor?: string;
  /** 1..200, default 60. */
  readonly limit?: number;
}

export interface BrowsePage {
  readonly items: AssetSummary[];
  readonly total: number;
  readonly nextCursor?: string;
}

const SORT_KEYS: Record<LibrarySort, string> = {
  captured: 'coalesce(a.capture_time, a.created_at)',
  added: 'a.created_at',
  duration: `coalesce(CAST(a.duration_value AS REAL) * a.duration_rate_den / a.duration_rate_num, -1)`,
  quality: 'coalesce((SELECT MAX(q.quality) FROM shots q WHERE q.asset_id = a.id), -1)',
};

function encodeCursor(key: number, id: string): string {
  return Buffer.from(JSON.stringify([key, id])).toString('base64url');
}

function decodeCursor(cursor: string): [number, string] | null {
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (Array.isArray(value) && typeof value[0] === 'number' && typeof value[1] === 'string')
      return [value[0], value[1]];
  } catch {
    // Not ours: refused below.
  }
  return null;
}

export function browseAssets(db: LibraryDatabase, input: BrowseInput = {}): Result<BrowsePage> {
  const sort = input.sort ?? 'captured';
  const desc = (input.direction ?? 'desc') === 'desc';
  const limit = Math.max(1, Math.min(200, Math.floor(input.limit ?? 60)));
  const filters = filterSql(input.filters, 'asset');
  const key = SORT_KEYS[sort];
  const where = [filters.where];
  const params: SqlValue[] = [...filters.params];
  if (input.cursor) {
    const after = decodeCursor(input.cursor);
    if (!after) return err(ValidationError({ field: 'cursor' }));
    const op = desc ? '<' : '>';
    where.push(`(${key} ${op} ? OR (${key} = ? AND a.id ${op} ?))`);
    params.push(after[0], after[0], after[1]);
  }
  const order = desc ? 'DESC' : 'ASC';
  const page = db.driver
    .prepare(
      `SELECT a.id AS id, ${key} AS sort_key FROM assets a WHERE ${where.join(' AND ')}
       ORDER BY sort_key ${order}, a.id ${order} LIMIT ?`,
    )
    .all(...params, limit + 1) as { id: AssetId; sort_key: number }[];
  const total = Number(
    db.driver.prepare(`SELECT COUNT(*) AS n FROM assets a WHERE ${filters.where}`).get(...filters.params)
      ?.n ?? 0,
  );
  const shown = page.slice(0, limit);
  const rows = shown.length
    ? db.orm
        .select()
        .from(assets)
        .where(
          inArray(
            assets.id,
            shown.map((r) => r.id),
          ),
        )
        .all()
    : [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const items = assetSummaries(db, shown.map((r) => byId.get(r.id)!).filter(Boolean));
  const last = shown.at(-1);
  return ok({
    items,
    total,
    ...(page.length > limit && last ? { nextCursor: encodeCursor(last.sort_key, last.id) } : {}),
  });
}
