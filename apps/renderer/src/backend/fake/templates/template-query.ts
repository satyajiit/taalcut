// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `templates.list`'s filters, sorts and paging as the templates service serves them (P3-V14; packages/templates
 * library/memory-template-query.ts): every filter absent means "any", tags match any of the asked, a trend date
 * older than `templates.staleAfterDays` is stale, ties break on the larger id, and the cursor is the next offset.
 * Free text matches as the library's does (template-terms.ts): every word a prefix of a token in the name, slot
 * intents, on-screen words or tags.
 */
import type { TemplateListQuery, TemplateSummary } from '@taalcut/core';
import { holds, listWords } from './template-terms';

export interface QueryRow {
  readonly summary: TemplateSummary;
  /** Timelines made from it (the "Most used" sort). */
  readonly used: number;
  /** The tokens of its name, slot intents, on-screen words and tags (template-terms.ts columnsOf). */
  readonly tokens: readonly string[];
  readonly fingerprints: readonly string[];
}

const DAY_MS = 86_400_000;

/** True when `date` (YYYY-MM-DD, UTC) is strictly older than `staleAfterDays` at `now`. */
export function isStale(date: string, now: number, staleAfterDays: number): boolean {
  // eslint-disable-next-line lingui/no-unlocalized-strings -- an ISO time suffix, not words
  const then = Date.parse(`${date}T00:00:00.000Z`);
  return Number.isFinite(then) && now - then > staleAfterDays * DAY_MS;
}

const idDesc = (a: QueryRow, b: QueryRow) =>
  a.summary.id < b.summary.id ? 1 : a.summary.id > b.summary.id ? -1 : 0;
const byNumber = (a: number, b: number, dir: 'asc' | 'desc') => (dir === 'asc' ? a - b : b - a);

function byTrend(a: string | null, b: string | null, dir: 'asc' | 'desc'): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  const diff = a < b ? -1 : a > b ? 1 : 0;
  return dir === 'desc' ? -diff : diff;
}

function compare(a: QueryRow, b: QueryRow, query: TemplateListQuery): number {
  const dir = query.dir ?? 'desc';
  const x = a.summary;
  const y = b.summary;
  let primary: number;
  switch (query.sort) {
    case 'updated':
      primary = byNumber(x.updatedAt, y.updatedAt, dir);
      break;
    case 'name':
      primary = dir === 'asc' ? x.name.localeCompare(y.name) : y.name.localeCompare(x.name);
      break;
    case 'trend':
      primary = byTrend(x.trendFreshness?.date ?? null, y.trendFreshness?.date ?? null, dir);
      break;
    case 'favourite':
      primary = byNumber(x.favourite ? 1 : 0, y.favourite ? 1 : 0, dir);
      break;
    case 'used':
      primary = byNumber(a.used, b.used, dir);
      break;
    case undefined:
      primary = y.createdAt - x.createdAt;
      break;
  }
  return primary || idDesc(a, b);
}

interface Context {
  readonly now: number;
  readonly staleAfterDays: number;
  readonly words: readonly string[];
}

type Filter = (row: QueryRow, query: TemplateListQuery, context: Context) => boolean;

const FILTERS: readonly Filter[] = [
  ({ summary }, query) => query.includeUnlisted || summary.listed,
  ({ summary }, query) => query.includeArchived || !summary.archived,
  ({ summary }, query) => query.projectId === undefined || summary.projectId === query.projectId,
  (row, query) => query.fingerprint === undefined || row.fingerprints.includes(query.fingerprint),
  (row, _query, { words }) => words.every((word) => holds(row.tokens, word)),
  ({ summary }, { tags }) => !tags || tags.length === 0 || tags.some((tag) => summary.tags.includes(tag)),
  ({ summary }, { folderId }) =>
    folderId === undefined || summary.folderId === (folderId === 'none' ? null : folderId),
  ({ summary }, { favourite }) => favourite === undefined || summary.favourite === favourite,
  ({ summary }, { formatId }) => formatId === undefined || summary.formatId === formatId,
  ({ summary }, { language }) => language === undefined || summary.language === language,
  ({ summary }, { origin }) => origin === undefined || summary.origin === origin,
  ({ summary }, { stale }, { now, staleAfterDays }) =>
    stale === undefined ||
    stale === (summary.trendFreshness !== null && isStale(summary.trendFreshness.date, now, staleAfterDays)),
];

/** One page of the rows that pass every filter, in the asked order; `nextCursor` is null on the last page. */
export function selectTemplates(
  rows: readonly QueryRow[],
  query: TemplateListQuery,
  now: number,
  staleAfterDays: number,
): { items: TemplateSummary[]; nextCursor: string | null } {
  const words = listWords(query.query ?? '');
  const context: Context = { now, staleAfterDays, words };
  const matches = rows
    .filter((row) => FILTERS.every((filter) => filter(row, query, context)))
    .sort((a, b) => compare(a, b, query));
  const start = query.cursor ? Number(query.cursor) || 0 : 0;
  const end = start + query.limit;
  return {
    items: matches.slice(start, end).map((row) => row.summary),
    nextCursor: end < matches.length ? String(end) : null,
  };
}
