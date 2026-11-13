// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The template library's state in its URL (P3-V14): `/templates?q=…&folder=…&tags=food,travel&format=vlog&lang=hi
 * &length=short&stale=true&sort=name&dir=asc`, so a view can be linked to, reloaded and reached from a card ("Open
 * the folder"). Parsed in the entry chunk with the route, so no core runtime here (test/templates-library-search
 * keeps the lists in step with core's): unknown values are dropped, never an error.
 */
import type { FormatId, TemplateFolderId, TemplateListQuery, TemplateSort } from '@taalcut/core';
import { searchId } from '../../../shell/route-id';

export const TEMPLATE_SORT_CHOICES = [
  'updated',
  'name',
  'trend',
  'favourite',
  'used',
] as const satisfies readonly TemplateSort[];
export const TEMPLATE_FORMATS = [
  'vlog',
  'dayInTheLife',
  'talkingHead',
  'podcastClip',
  'ugcAd',
  'beforeAfter',
  'tutorial',
  'highlightReel',
] as const satisfies readonly FormatId[];
export const TEMPLATE_LENGTHS = ['short', 'medium', 'long'] as const;
/** The folder rail's views beside the folders themselves. */
export const LIBRARY_VIEWS = ['favourites', 'unfiled'] as const;

export type TemplateLength = (typeof TEMPLATE_LENGTHS)[number];
export type LibraryView = (typeof LIBRARY_VIEWS)[number];

export interface TemplateSearch {
  /** Words in a name, a tag, a slot's intent or the on-screen text. */
  readonly q?: string | undefined;
  /** Favourites, not in a folder, or one folder; absent: every template. */
  readonly folder?: LibraryView | TemplateFolderId | undefined;
  /** Comma-separated; a template with any of them matches. */
  readonly tags?: string | undefined;
  readonly format?: FormatId | undefined;
  readonly lang?: string | undefined;
  readonly length?: TemplateLength | undefined;
  /** Only those whose trend may be stale. */
  readonly stale?: true | undefined;
  readonly sort?: TemplateSort | undefined;
  readonly dir?: 'asc' | 'desc' | undefined;
}

/** Seconds at most for short, and for medium. */
const SHORT_MAX = 15;
const MEDIUM_MAX = 30;
const MAX_TAGS = 12;
const TAG = /^[\p{L}\p{M}\p{N}]+(?:-[\p{L}\p{M}\p{N}]+)*$/u;
const LANGUAGE = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

const oneOf = <T extends string>(values: readonly T[], value: unknown): T | undefined =>
  typeof value === 'string' && (values as readonly string[]).includes(value) ? (value as T) : undefined;

/** Valid tags in a comma list (or the array a hand-written link may carry), lower case, at most twelve. */
export function parseTags(value: unknown): string[] {
  const raw = Array.isArray(value) ? value.join(',') : typeof value === 'string' ? value : '';
  const tags = raw
    .split(',')
    .map((tag) => tag.trim().normalize('NFC').toLowerCase())
    .filter((tag) => tag.length <= 32 && TAG.test(tag));
  return [...new Set(tags)].slice(0, MAX_TAGS);
}

/** The words searched for a field's text: trimmed, at most 200 characters (as templates.search takes them). */
export const searchWordsOf = (text: string): string => text.trim().slice(0, 200);

/** The router spreads the raw search under this result, so bad values are set to undefined, not left out. */
export function parseTemplateSearch(search: Record<string, unknown>): TemplateSearch {
  const q = typeof search.q === 'string' ? searchWordsOf(search.q) : '';
  const tags = parseTags(search.tags);
  const lang = typeof search.lang === 'string' ? search.lang.trim() : '';
  return {
    q: q || undefined,
    folder: oneOf(LIBRARY_VIEWS, search.folder) ?? searchId<'TemplateFolder'>(search.folder),
    tags: tags.length > 0 ? tags.join(',') : undefined,
    format: oneOf(TEMPLATE_FORMATS, search.format),
    lang: LANGUAGE.test(lang) ? lang : undefined,
    length: oneOf(TEMPLATE_LENGTHS, search.length),
    stale: search.stale === true || search.stale === 'true' ? true : undefined,
    sort: oneOf(TEMPLATE_SORT_CHOICES, search.sort),
    dir: oneOf(['asc', 'desc'] as const, search.dir),
  };
}

export const tagsOf = (search: TemplateSearch): string[] => (search.tags ? search.tags.split(',') : []);

/** The sort in effect: recently changed first when the URL names none. */
export function sortOf(search: TemplateSearch): { sort: TemplateSort; dir: 'asc' | 'desc' } {
  const sort = search.sort ?? 'updated';
  return { sort, dir: search.dir ?? (sort === 'name' ? 'asc' : 'desc') };
}

/**
 * What templates.list is asked for this view without words: its folder, filters and sort (length is the window's to
 * apply: the list has no such filter). With words the page asks templates.search instead (search-scope.ts), so the
 * words never reach the list's own stricter word filter: one search, one answer (LRN1-FIX).
 */
export function listQueryOf(search: TemplateSearch): Partial<TemplateListQuery> {
  const tags = tagsOf(search);
  const { folder } = search;
  return {
    ...(folder === 'favourites' ? { favourite: true } : folder === 'unfiled' ? { folderId: 'none' } : {}),
    ...(folder && folder !== 'favourites' && folder !== 'unfiled' ? { folderId: folder } : {}),
    ...(tags.length > 0 ? { tags } : {}),
    ...(search.format ? { formatId: search.format } : {}),
    ...(search.lang ? { language: search.lang } : {}),
    ...(search.stale ? { stale: true } : {}),
    ...sortOf(search),
  };
}

/** Which length a template of this many seconds is. */
export function lengthOf(seconds: number): TemplateLength {
  return seconds <= SHORT_MAX ? 'short' : seconds <= MEDIUM_MAX ? 'medium' : 'long';
}

const DAY_MS = 86_400_000;
/** templates.staleAfterDays' default (core's STALE_AFTER_DAYS_SETTING; the window doesn't read settings yet). */
export const STALE_AFTER_DAYS = 90;

/** True when a trend date (YYYY-MM-DD, UTC) is older than `days` at `now`, as the service decides it. */
export function isTrendStale(date: string, now: number, days = STALE_AFTER_DAYS): boolean {
  const [year = Number.NaN, month = Number.NaN, day = Number.NaN] = date.split('-').map(Number);
  const then = Date.UTC(year, month - 1, day);
  return Number.isFinite(then) && now - then > days * DAY_MS;
}

/** True when a filter narrows the list (the folder, the words and the sort don't count). */
export function hasFilters(search: TemplateSearch): boolean {
  return Boolean(search.tags || search.format || search.lang || search.length || search.stale);
}

/** Every filter off, keeping the folder and the sort. */
export const CLEARED: Partial<TemplateSearch> = {
  q: undefined,
  tags: undefined,
  format: undefined,
  lang: undefined,
  length: undefined,
  stale: undefined,
};
