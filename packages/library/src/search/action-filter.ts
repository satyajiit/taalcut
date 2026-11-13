// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The action filter's SQL (LIB1-FIND), for the library's filters (profile/filters.ts). */
import type { SqlValue } from '../driver/types';

/**
 * The condition "shows any of these actions", over `s` (a shot) or `a` (an asset with such a shot). Actions are
 * matched lowercase, as stored.
 */
export function actionCondition(
  actions: readonly string[],
  level: 'asset' | 'shot',
): { readonly sql: string; readonly params: SqlValue[] } {
  const params = [JSON.stringify(actions.map((action) => action.normalize('NFC').toLowerCase()))];
  const within = 'x.action IN (SELECT value FROM json_each(?))';
  return level === 'shot'
    ? { sql: `EXISTS (SELECT 1 FROM shot_actions x WHERE x.shot_id = s.id AND ${within})`, params }
    : {
        sql: `EXISTS (SELECT 1 FROM shot_actions x JOIN shots q ON q.id = x.shot_id WHERE q.asset_id = a.id AND ${within})`,
        params,
      };
}
