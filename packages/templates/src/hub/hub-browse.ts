// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Browsing the cached index (P3-B12, P3-V8): filter, rank (top rated, newest, freshest), page, and each row with
 * its rating and this install's fork.
 */
import {
  ok,
  RationalTime,
  type AsyncResult,
  type HubBrowseItem,
  type HubBrowsePage,
  type HubBrowseQuery,
  type HubIndexEntry,
  type HubSort,
  type HubTemplateId,
  type TemplateId,
} from '@taalcut/core';
import type { RatingsTable } from './index-cache';

export type ForkedTemplate = (hubId: HubTemplateId) => AsyncResult<TemplateId | null>;

function matches(entry: HubIndexEntry, query: HubBrowseQuery): boolean {
  if (query.language !== undefined && entry.language !== query.language) return false;
  if (query.formatId !== undefined && entry.formatId !== query.formatId) return false;
  if (query.maxSeconds !== undefined && RationalTime.toSeconds(entry.duration) > query.maxSeconds)
    return false;
  if (query.tags !== undefined && !query.tags.every((tag) => entry.tags.includes(tag))) return false;
  const needle = query.query?.trim().toLowerCase() ?? '';
  if (!needle) return true;
  return [entry.name, entry.description, entry.handle, ...entry.tags]
    .join('\n')
    .toLowerCase()
    .includes(needle);
}

const byId = (a: HubIndexEntry, b: HubIndexEntry) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const newest = (a: HubIndexEntry, b: HubIndexEntry) =>
  b.updatedAt - a.updatedAt || b.createdAt - a.createdAt || byId(a, b);

function freshest(a: HubIndexEntry, b: HubIndexEntry): number {
  if (a.trendFreshness === b.trendFreshness) return newest(a, b);
  if (a.trendFreshness === null) return 1;
  if (b.trendFreshness === null) return -1;
  return a.trendFreshness < b.trendFreshness ? 1 : -1;
}

const RANKINGS: Record<HubSort, (ratings: RatingsTable) => (a: HubIndexEntry, b: HubIndexEntry) => number> = {
  newest: () => newest,
  freshest: () => freshest,
  /** Unrated last; ties by how many rated it, then newest. */
  topRated: (ratings) => (a, b) => {
    const mean = (entry: HubIndexEntry) => ratings[entry.id]?.mean ?? -1;
    const count = (entry: HubIndexEntry) => ratings[entry.id]?.count ?? -1;
    return mean(b) - mean(a) || count(b) - count(a) || newest(a, b);
  },
};

/** One row as browse shows it. */
export async function browseItem(
  entry: HubIndexEntry,
  ratings: RatingsTable,
  forkedTemplate: ForkedTemplate | undefined,
): AsyncResult<HubBrowseItem> {
  const forkedAs = forkedTemplate ? await forkedTemplate(entry.id) : ok(null);
  if (!forkedAs.ok) return forkedAs;
  return ok({ ...entry, rating: ratings[entry.id] ?? null, forkedAs: forkedAs.value });
}

/** `cursor` is the offset into the ranked list, as browse returned it. */
export async function browsePage(
  entries: readonly HubIndexEntry[],
  query: HubBrowseQuery,
  start: number,
  ratings: RatingsTable,
  forkedTemplate: ForkedTemplate | undefined,
): AsyncResult<HubBrowsePage> {
  const ranked = entries.filter((entry) => matches(entry, query)).sort(RANKINGS[query.sort](ratings));
  const items: HubBrowseItem[] = [];
  for (const entry of ranked.slice(start, start + query.limit)) {
    const item = await browseItem(entry, ratings, forkedTemplate);
    if (!item.ok) return item;
    items.push(item.value);
  }
  const next = start + query.limit;
  return ok({ items, nextCursor: next < ranked.length ? String(next) : null });
}
