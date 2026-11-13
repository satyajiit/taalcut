// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * 24 h cache of stock search responses (Pexels allows caching API responses
 * for about a day). `import:` keys are the import→asset link and do not expire.
 */
import type { StockSearchInput } from '@taalcut/core';
import type { LibraryDatabase } from '../db/database';
import type { SqlRow, SqlValue } from '../driver/types';

export const STOCK_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export interface StockCache {
  /** Null when missing or older than 24 h (`import:` keys are exempt). */
  get(key: string, now: number): string | null;
  put(key: string, provider: string, body: string, now: number): void;
}

export function searchCacheKey(provider: string, input: StockSearchInput): string {
  return [
    'search',
    provider,
    input.kind,
    input.query,
    input.orientation ?? '',
    input.minSeconds ?? '',
    input.maxSeconds ?? '',
    input.page,
  ].join('\u001f');
}

export function stockItemCacheKey(provider: string, providerId: string, renditionKey: string): string {
  return `item:${provider}:${providerId}:${renditionKey}`;
}

interface Entry {
  readonly body: string;
  readonly at: number;
}

export function createMemoryStockCache(ttlMs = STOCK_CACHE_TTL_MS): StockCache {
  const rows = new Map<string, Entry>();
  return {
    get(key, now) {
      const row = rows.get(key);
      if (!row) return null;
      if (!key.startsWith('import:') && now - row.at > ttlMs) return null;
      return row.body;
    },
    put(key, _provider, body, now) {
      rows.set(key, { body, at: now });
    },
  };
}

function cachedBody(row: SqlRow | undefined, key: string, now: number, ttlMs: number): string | null {
  if (!row || typeof row.body !== 'string') return null;
  if (key.startsWith('import:')) return row.body;
  const at = stamp(row.fetched_at);
  if (at === null || now - at > ttlMs) return null;
  return row.body;
}

function stamp(value: SqlValue | undefined): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'bigint') return Number(value);
  return null;
}

/** The same 24 h rule as the memory cache, in `stock_search_cache`. `import:` keys do not expire. */
export function createSqliteStockCache(db: LibraryDatabase, ttlMs = STOCK_CACHE_TTL_MS): StockCache {
  const read = db.driver.prepare('SELECT body, fetched_at FROM stock_search_cache WHERE key = ?');
  const write = db.driver.prepare(
    `INSERT INTO stock_search_cache (key, provider, body, fetched_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       provider = excluded.provider, body = excluded.body, fetched_at = excluded.fetched_at`,
  );
  return {
    get(key, now) {
      return cachedBody(read.get(key), key, now, ttlMs);
    },
    put(key, provider, body, now) {
      write.run(key, provider, body, now);
    },
  };
}
