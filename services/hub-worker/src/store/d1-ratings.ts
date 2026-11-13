// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { z } from 'zod';

import { type D1Database } from './d1';

/** One row per (template, install): a second rating from the same install replaces the first. */
const UPSERT =
  'INSERT INTO ratings (hub_id, rater, stars, at) VALUES (?, ?, ?, ?) ON CONFLICT (hub_id, rater) DO UPDATE SET stars = excluded.stars, at = excluded.at';
const REMOVE = 'DELETE FROM ratings WHERE hub_id = ? AND rater = ?';
const ONE = 'SELECT COUNT(*) AS count, AVG(stars) AS mean FROM ratings WHERE hub_id = ?';
const ALL = 'SELECT hub_id, COUNT(*) AS count, AVG(stars) AS mean FROM ratings GROUP BY hub_id';

export interface RatingSummary {
  count: number;
  mean: number;
}

export interface RatingGroup extends RatingSummary {
  hubId: string;
}

/** AVG over no rows is NULL; stars are 1 to 5 (a CHECK constraint), so a mean is too. */
const aggregate = z
  .object({ count: z.number().int().nonnegative(), mean: z.number().min(1).max(5).nullable() })
  .transform(({ count, mean }): RatingSummary => ({ count, mean: mean ?? 0 }));
const groupRow = z.object({ hub_id: z.string() }).and(aggregate);

export async function upsertRating(
  db: D1Database,
  hubId: string,
  rater: string,
  stars: number,
  at: number,
): Promise<void> {
  await db.prepare(UPSERT).bind(hubId, rater, stars, at).run();
}

export async function deleteRating(db: D1Database, hubId: string, rater: string): Promise<void> {
  await db.prepare(REMOVE).bind(hubId, rater).run();
}

export async function ratingSummary(db: D1Database, hubId: string): Promise<RatingSummary> {
  return aggregate.parse(await db.prepare(ONE).bind(hubId).first());
}

export async function ratingGroups(db: D1Database): Promise<RatingGroup[]> {
  const rows = await db.prepare(ALL).all();
  return rows.results.map((row) => {
    const { hub_id: hubId, count, mean } = groupRow.parse(row);
    return { hubId, count, mean };
  });
}
