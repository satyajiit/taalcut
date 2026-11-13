// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * /templates/hub's search and filters in the URL (P3-B12, P3-V8), so a card's "Show more" and the back button
 * land on the same list: `?q=café&lang=pt-BR&format=vlog&max=30&tags=food,travel&sort=newest`. Anything the
 * hub's browse query wouldn't take is dropped, never sent.
 */
import { FORMAT_IDS, HUB_SORTS, type FormatId, type HubBrowseQuery, type HubSort } from '@taalcut/core';

export interface HubSearch {
  readonly q?: string | undefined;
  readonly lang?: string | undefined;
  readonly format?: FormatId | undefined;
  /** At most this long, in seconds. */
  readonly max?: number | undefined;
  readonly tags?: string | undefined;
  readonly sort?: HubSort | undefined;
}

/** The lengths the filter offers, in seconds. */
export const HUB_LENGTHS = [15, 30, 60, 90] as const;

const LANGUAGE = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;
const TAG = /^[a-z0-9][a-z0-9-]{0,23}$/;

const text = (value: unknown) => (typeof value === 'string' ? value.trim().slice(0, 200) : '');

export function parseHubSearch(search: Record<string, unknown>): HubSearch {
  const q = text(search.q);
  const lang = text(search.lang);
  const format = FORMAT_IDS.find((id) => id === search.format);
  const max = Number(search.max);
  const tags = text(search.tags)
    .split(',')
    .filter((tag) => TAG.test(tag))
    .slice(0, 8);
  const sort = HUB_SORTS.find((id) => id === search.sort);
  return {
    q: q || undefined,
    lang: LANGUAGE.test(lang) ? lang : undefined,
    format,
    max: HUB_LENGTHS.find((length) => length === max),
    tags: tags.length > 0 ? tags.join(',') : undefined,
    // Top rated is the default and stays out of the URL.
    sort: sort === 'topRated' ? undefined : sort,
  };
}

export function tagsOf(search: HubSearch): string[] {
  return search.tags ? search.tags.split(',') : [];
}

/** What hub.browse is asked for this search. */
export function browseQueryOf(search: HubSearch, cursor?: string): Partial<HubBrowseQuery> {
  const tags = tagsOf(search);
  return {
    ...(search.q ? { query: search.q } : {}),
    ...(search.lang ? { language: search.lang } : {}),
    ...(search.format ? { formatId: search.format } : {}),
    ...(search.max ? { maxSeconds: search.max } : {}),
    ...(tags.length > 0 ? { tags } : {}),
    sort: search.sort ?? 'topRated',
    limit: 20,
    ...(cursor ? { cursor } : {}),
  };
}

/** Whether any filter narrows the list (No results then offers Clear filters). */
export function isFiltered(search: HubSearch): boolean {
  return !!(search.q || search.lang || search.format || search.max || search.tags);
}
