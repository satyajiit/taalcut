// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** List filters and sorts for the memory TemplateStore (P3-V14). Absent sort keeps Phase 2's order. */
import type { TemplateListQuery } from '@taalcut/core';
import { isStale } from './freshness';

export interface QueryRow {
  readonly id: string;
  readonly name: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly listed: boolean;
  readonly archived: boolean;
  readonly projectId: string | null;
  readonly tags: readonly string[];
  readonly folderId: string | null;
  readonly favourite: boolean;
  readonly trendDate: string | null;
  readonly used: number;
  readonly origin: string;
  readonly formatId: string | null;
  readonly language: string | null;
  readonly search: string;
  readonly fingerprints: readonly string[];
}

function idDesc(a: QueryRow, b: QueryRow): number {
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

function byNumber(a: number, b: number, dir: 'asc' | 'desc'): number {
  return dir === 'asc' ? a - b : b - a;
}

function byTrend(a: string | null, b: string | null, dir: 'asc' | 'desc'): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  const diff = a < b ? -1 : a > b ? 1 : 0;
  return dir === 'desc' ? -diff : diff;
}

function compare(a: QueryRow, b: QueryRow, query: TemplateListQuery): number {
  const dir = query.dir ?? 'desc';
  let primary: number;
  switch (query.sort) {
    case 'updated':
      primary = byNumber(a.updatedAt, b.updatedAt, dir);
      break;
    case 'name':
      primary = dir === 'asc' ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name);
      break;
    case 'trend':
      primary = byTrend(a.trendDate, b.trendDate, dir);
      break;
    case 'favourite':
      primary = byNumber(a.favourite ? 1 : 0, b.favourite ? 1 : 0, dir);
      break;
    case 'used':
      primary = byNumber(a.used, b.used, dir);
      break;
    case undefined:
      primary = b.createdAt - a.createdAt;
      break;
    default: {
      const never: never = query.sort;
      primary = never;
    }
  }
  return primary || idDesc(a, b);
}

interface FilterContext {
  readonly now: number;
  readonly staleAfterDays: number;
  /** The free-text query's words, lower case. */
  readonly words: readonly string[];
}

type Filter = (row: QueryRow, query: TemplateListQuery, context: FilterContext) => boolean;

/** Each list filter, absent meaning "any". A row is listed when every one passes. */
const FILTERS: readonly Filter[] = [
  (row, query) => query.includeUnlisted || row.listed,
  (row, query) => query.includeArchived || !row.archived,
  (row, query) => query.projectId === undefined || row.projectId === query.projectId,
  (row, query) => query.fingerprint === undefined || row.fingerprints.includes(query.fingerprint),
  (row, _query, { words }) => words.every((word) => row.search.includes(word)),
  (row, { tags }) => !tags || tags.length === 0 || tags.some((tag) => row.tags.includes(tag)),
  (row, { folderId }) => folderId === undefined || row.folderId === (folderId === 'none' ? null : folderId),
  (row, { favourite }) => favourite === undefined || row.favourite === favourite,
  (row, { formatId }) => formatId === undefined || row.formatId === formatId,
  (row, { language }) => language === undefined || row.language === language,
  (row, { origin }) => origin === undefined || row.origin === origin,
  (row, { stale }, { now, staleAfterDays }) =>
    stale === undefined || stale === (row.trendDate !== null && isStale(row.trendDate, now, staleAfterDays)),
];

/** Phase 2 order when `sort` is absent: newest `createdAt`, then the larger id. */
export function selectTemplates<T extends QueryRow>(
  rows: readonly T[],
  query: TemplateListQuery,
  now: number,
  staleAfterDays: number,
): T[] {
  const words = (query.query ?? '').toLowerCase().split(/\s+/u).filter(Boolean);
  const context: FilterContext = { now, staleAfterDays, words };
  return rows
    .filter((row) => FILTERS.every((filter) => filter(row, query, context)))
    .sort((a, b) => compare(a, b, query));
}
