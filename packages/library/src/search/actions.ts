// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What people in shots are doing, as the library's filters and the filter's choices (LIB1-FIND), read from
 * `shot_actions` (migration shot_actions: one row per shot and action, kept in step with each analysis).
 */
import { ACTION_COUNTS_MAX, actionCountSchema, ok, type ActionCount, type Result } from '@taalcut/core';
import type { LibraryDatabase } from '../db/database';
import { filterSql } from '../profile/filters';

/** Every action the library's shots show, with the clips that show it, most first (the library's defaults hide the trash). */
export function actionCounts(db: LibraryDatabase, limit = ACTION_COUNTS_MAX): Result<ActionCount[]> {
  const visible = filterSql(undefined, 'asset');
  const rows = db.driver
    .prepare(
      `SELECT x.action AS action, count(DISTINCT q.asset_id) AS assets
         FROM shot_actions x JOIN shots q ON q.id = x.shot_id JOIN assets a ON a.id = q.asset_id
        WHERE ${visible.where}
        GROUP BY x.action ORDER BY assets DESC, x.action LIMIT ?`,
    )
    .all(...visible.params, limit);
  return ok(
    rows.flatMap((row) => {
      const parsed = actionCountSchema.safeParse({ action: row.action, assets: Number(row.assets) });
      return parsed.success ? [parsed.data] : [];
    }),
  );
}
