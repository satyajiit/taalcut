// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The library page's state in its URL (`/library?q=…&shape=portrait…`), so a
 * view can be linked to, reloaded and reached from a card ("See which" opens
 * `?filter=failed`). Parsed in the entry chunk with the route, so no core
 * runtime here: unknown values are dropped, never an error.
 */
import type { ShotId, SourceId, TripId } from '@taalcut/core';
import { searchId } from '../../shell/route-id';

export const SHAPES = ['portrait', 'landscape', 'square'] as const;
export const LENGTHS = ['short', 'medium', 'long'] as const;
export const QUALITIES = ['good', 'great'] as const;
export const PERIODS = ['week', 'month', 'year'] as const;
export const SORTS = ['captured', 'added', 'duration', 'quality'] as const;

export type Shape = (typeof SHAPES)[number];
export type Length = (typeof LENGTHS)[number];
export type Quality = (typeof QUALITIES)[number];
export type Period = (typeof PERIODS)[number];
export type Sort = (typeof SORTS)[number];

export interface LibrarySearch {
  /** Words to search for: a description, something said, text on screen. */
  q?: string | undefined;
  shape?: Shape | undefined;
  length?: Length | undefined;
  quality?: Quality | undefined;
  when?: Period | undefined;
  source?: SourceId | undefined;
  /** What people in the clip are doing (LIB1-FIND): a stored action, "dancing" or a free one. */
  action?: string | undefined;
  /** The trip place grouped the clip into (LIB1-FIND). */
  trip?: TripId | undefined;
  /** Where it was filmed, from coordinates (LIB1-FIND): a country by its ISO code ("PT")… */
  country?: string | undefined;
  /** …or a city by its GeoNames id (2267057). */
  city?: number | undefined;
  sort?: Sort | undefined;
  dir?: 'asc' | 'desc' | undefined;
  /** Clips that couldn't be read. */
  filter?: 'failed' | undefined;
  /** Shots like this one. */
  similar?: ShotId | undefined;
}

/** A stored action as core's shotActionSchema reads one: lowercase letters, marks, digits, spaces, - and '. */
const ACTION = /^[\p{Ll}\p{Lo}\p{M}\p{N}' -]{1,32}$/u;

/** A country in the URL: its ISO code. */
const COUNTRY = /^[A-Z]{2}$/;

const oneOf = <T extends string>(values: readonly T[], value: unknown): T | undefined =>
  typeof value === 'string' && (values as readonly string[]).includes(value) ? (value as T) : undefined;

/** The router spreads the raw search under this result, so bad values are set to undefined, not left out. */
export function parseLibrarySearch(search: Record<string, unknown>): LibrarySearch {
  const q = typeof search.q === 'string' ? search.q.slice(0, 500) : undefined;
  return {
    q: q?.trim() ? q : undefined,
    shape: oneOf(SHAPES, search.shape),
    length: oneOf(LENGTHS, search.length),
    quality: oneOf(QUALITIES, search.quality),
    when: oneOf(PERIODS, search.when),
    source: searchId<'Source'>(search.source),
    action: typeof search.action === 'string' && ACTION.test(search.action) ? search.action : undefined,
    trip: searchId<'Trip'>(search.trip),
    country: typeof search.country === 'string' && COUNTRY.test(search.country) ? search.country : undefined,
    city:
      Number.isSafeInteger(search.city) && (search.city as number) > 0 ? (search.city as number) : undefined,
    sort: oneOf(SORTS, search.sort),
    dir: oneOf(['asc', 'desc'] as const, search.dir),
    filter: search.filter === 'failed' ? 'failed' : undefined,
    similar: searchId<'Shot'>(search.similar),
  };
}

/** The filters a Clear filters lets go (search words and sort stay): the toolbar's and the empty results'. */
export const NO_FILTERS: Partial<LibrarySearch> = {
  shape: undefined,
  length: undefined,
  quality: undefined,
  when: undefined,
  source: undefined,
  action: undefined,
  trip: undefined,
  country: undefined,
  city: undefined,
  filter: undefined,
};

/** True when any filter narrows the clips (search words and sort don't count). */
export function hasFilters(search: LibrarySearch): boolean {
  return Boolean(
    search.shape ||
    search.length ||
    search.quality ||
    search.when ||
    search.source ||
    search.action ||
    search.trip ||
    search.country ||
    search.city ||
    search.filter,
  );
}
