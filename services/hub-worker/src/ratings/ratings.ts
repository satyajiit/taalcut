// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** One anonymous rating per install per template (P3-V8): upsert, withdraw, and the aggregate browse shows. */
import { takeRating, type LimitRefusal } from '../limits/rate-limits';
import { hiddenIds, type HiddenDeps } from '../moderation/hidden-ids';
import {
  deleteRating,
  ratingGroups,
  ratingSummary,
  upsertRating,
  type RatingSummary,
} from '../store/d1-ratings';
import { type D1Database, type RateLimitBinding } from '../store/d1';

export interface RatingDeps {
  db: D1Database;
  rateBurst: RateLimitBinding;
  now: () => number;
  hidden: HiddenDeps;
}

export type RatingResult =
  | { status: 200; body: RatingSummary }
  | { status: 409; body: { code: 'hub.hidden' } }
  | { status: 429; body: LimitRefusal }
  | { status: 503; body: { code: 'hub.github_unavailable' } };

const UNAVAILABLE = { status: 503, body: { code: 'hub.github_unavailable' } } as const;

/** A hidden template takes no new ratings. */
export async function putRating(
  deps: RatingDeps,
  hubId: string,
  hmac: string,
  stars: number,
): Promise<RatingResult> {
  const limit = await takeRating(deps.rateBurst, hmac);
  if (!limit.ok) return { status: 429, body: limit };
  const hidden = await hiddenIds(deps.hidden);
  if (!hidden.ok) return UNAVAILABLE;
  if (hidden.value.has(hubId)) return { status: 409, body: { code: 'hub.hidden' } };
  await upsertRating(deps.db, hubId, hmac, stars, deps.now());
  return { status: 200, body: await ratingSummary(deps.db, hubId) };
}

/** Withdrawing works on a hidden template too: it only removes this install's own row. */
export async function withdrawRating(deps: RatingDeps, hubId: string, hmac: string): Promise<RatingResult> {
  const limit = await takeRating(deps.rateBurst, hmac);
  if (!limit.ok) return { status: 429, body: limit };
  await deleteRating(deps.db, hubId, hmac);
  return { status: 200, body: await ratingSummary(deps.db, hubId) };
}

export type RatingsList =
  { status: 200; body: { generatedAt: number; ratings: Record<string, RatingSummary> } } | typeof UNAVAILABLE;

/** Every rated template's aggregate, hidden ones left out. */
export async function listRatings(deps: RatingDeps): Promise<RatingsList> {
  const hidden = await hiddenIds(deps.hidden);
  if (!hidden.ok) return UNAVAILABLE;
  const ratings: Record<string, RatingSummary> = {};
  for (const group of await ratingGroups(deps.db)) {
    if (hidden.value.has(group.hubId) || group.count === 0) continue;
    ratings[group.hubId] = { count: group.count, mean: group.mean };
  }
  return { status: 200, body: { generatedAt: deps.now(), ratings } };
}
