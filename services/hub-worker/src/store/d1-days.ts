// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { z } from 'zod';

import { type D1Database } from './d1';

/**
 * Takes one unit of a daily cap in one statement: the upsert only counts while `n` is under the cap, and RETURNING
 * yields no row once it is reached. Check and increment are one write, so two requests at once can't both pass
 * the last slot.
 */
const TAKE =
  'INSERT INTO day_counts (key, day, n) VALUES (?, ?, 1) ON CONFLICT (key, day) DO UPDATE SET n = n + 1 WHERE n < ? RETURNING n';

const countRow = z.object({ n: z.number().int().positive() });

/** True when a unit was taken; false when `key` already used `cap` units on `day`. */
export async function takeDailyUnit(db: D1Database, key: string, day: string, cap: number): Promise<boolean> {
  const row = await db.prepare(TAKE).bind(key, day, cap).first();
  if (row === null) return false;
  return countRow.parse(row).n <= cap;
}
