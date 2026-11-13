// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Core's LibraryFilters as SQL over `assets a` (browse) or `shots s JOIN
 * assets a` (search, casting). Parameters are bound, never interpolated.
 * Always hidden: detached assets (no location left), Live Photo movie halves
 * (shown through their still) and, unless asked, the trash. Default
 * availability is online, offline and iCloud placeholder (missing is hidden).
 */
import type { LibraryFilters, RationalTime } from '@taalcut/core';
import type { SqlValue } from '../driver/types';
import { actionCondition } from '../search/action-filter';
import { undecidedLanguageSql } from '../speech/held-language';
import { placeConditions } from '../search/place-filter';

export interface FilterSql {
  /** ANDed conditions, without the WHERE keyword ('1' when there are none). */
  readonly where: string;
  readonly params: SqlValue[];
}

export const DEFAULT_AVAILABILITY = ['online', 'offline', 'icloud_placeholder'] as const;

/**
 * Excludes AI-generated thumbnails/covers/workspace renders and bundled SFX from user-facing Library views,
 * while keeping human voice recordings (`kind: 'captured'`), stock imports (`kind: 'stock'`), and damaged rows.
 */
export const USER_IMPORTED_ASSET_SQL =
  "NOT (json_valid(a.provenance) AND json_extract(a.provenance, '$.kind') IN ('generated', 'bundled') AND (json_extract(a.provenance, '$.provider') IS NOT NULL OR json_extract(a.provenance, '$.pack') IS NOT NULL))";

/** `?` bound to a JSON array, for `IN (SELECT value FROM json_each(?))`. */
const inList = (column: string) => `${column} IN (SELECT value FROM json_each(?))`;

/** seconds(value at num/den) compared with seconds(limit), in integers: value·den·L.num ⋚ L.value·L.den·num. */
function durationCompare(prefix: string, op: '>=' | '<=', limit: RationalTime): [string, SqlValue[]] {
  return [
    `(${prefix}duration_value IS NOT NULL AND ` +
      `${prefix}duration_value * ${prefix}duration_rate_den * ? ${op} ? * ? * ${prefix}duration_rate_num)`,
    [limit.rate.num, limit.value, limit.rate.den],
  ];
}

/** The asset's indexing state from its stage rows (`a` is the asset). */
export const ASSET_INDEX_STATE_SQL = `CASE
  WHEN EXISTS (SELECT 1 FROM asset_index_stages x WHERE x.asset_id = a.id AND x.state = 'failed') THEN 'failed'
  WHEN EXISTS (SELECT 1 FROM asset_index_stages x WHERE x.asset_id = a.id AND x.state IN ('queued', 'running'))
    THEN 'indexing'
  WHEN EXISTS (SELECT 1 FROM asset_index_stages x WHERE x.asset_id = a.id)
    AND NOT EXISTS (SELECT 1 FROM asset_index_stages x WHERE x.asset_id = a.id AND x.state NOT IN ('done', 'skipped'))
    THEN 'done'
  ELSE 'waiting' END`;

/**
 * Conditions for `filters`. `level: 'asset'` reads durations and quality per asset (its best shot's
 * quality); `'shot'` per shot (`s`), and keeps one shot per near-duplicate group unless `bestTakesOnly` is false.
 */
export function filterSql(filters: LibraryFilters = {}, level: 'asset' | 'shot' = 'asset'): FilterSql {
  const where: string[] = ['a.detached_at IS NULL', 'a.companion_of IS NULL'];
  const params: SqlValue[] = [];
  const add = (condition: string, ...values: SqlValue[]) => {
    where.push(condition);
    params.push(...values);
  };
  if (!filters.includeTrashed) add('a.trashed_at IS NULL');
  if (!filters.includeGenerated && !filters.sourceIds) add(USER_IMPORTED_ASSET_SQL);
  add(inList('a.availability'), JSON.stringify(filters.availability ?? DEFAULT_AVAILABILITY));
  if (filters.kinds) add(inList('a.kind'), JSON.stringify(filters.kinds));
  if (filters.orientations) add(inList('a.orientation'), JSON.stringify(filters.orientations));
  const timePrefix = level === 'shot' ? 's.' : 'a.';
  if (filters.minDuration) {
    const [sql, values] = durationCompare(timePrefix, '>=', filters.minDuration);
    add(sql, ...values);
  }
  if (filters.maxDuration) {
    const [sql, values] = durationCompare(timePrefix, '<=', filters.maxDuration);
    add(sql, ...values);
  }
  if (filters.minQuality !== undefined) {
    if (level === 'shot') add('s.quality >= ?', filters.minQuality);
    else add('EXISTS (SELECT 1 FROM shots q WHERE q.asset_id = a.id AND q.quality >= ?)', filters.minQuality);
  }
  if (filters.capturedFrom !== undefined) add('a.capture_time >= ?', filters.capturedFrom);
  if (filters.capturedTo !== undefined) add('a.capture_time <= ?', filters.capturedTo);
  if (filters.sourceIds)
    add(
      `EXISTS (SELECT 1 FROM library_asset_sources l WHERE l.asset_id = a.id AND ${inList('l.source_id')})`,
      JSON.stringify(filters.sourceIds),
    );
  // LIB1-LANG: a language with no decision behind it (an old step's guess) files nothing (held-language.ts).
  if (filters.languages)
    add(`(${inList('a.language')} AND NOT ${undecidedLanguageSql('a')})`, JSON.stringify(filters.languages));
  if (filters.hasSpeech !== undefined)
    add(`${filters.hasSpeech ? '' : 'NOT '}EXISTS (SELECT 1 FROM transcripts t WHERE t.asset_id = a.id)`);
  if (level === 'shot' && filters.bestTakesOnly !== false) add('s.best_take = 1');
  if (filters.indexStates) add(inList(`(${ASSET_INDEX_STATE_SQL})`), JSON.stringify(filters.indexStates));
  if (filters.actions) {
    const actions = actionCondition(filters.actions, level);
    add(actions.sql, ...actions.params);
  }
  for (const condition of placeConditions(filters)) add(condition.sql, ...condition.params);
  return { where: where.join(' AND '), params };
}
