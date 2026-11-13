// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { newId, ok, stockSearchPageSchema, type AsyncResult, type StockProviderId } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createPreviewCache } from '../../src/stock/preview-cache';
import { createMemoryStockCache, searchCacheKey } from '../../src/stock/search-cache';
import { createStockSearch, type StockSearchDeps } from '../../src/stock/stock-search';
import { freesoundProvider } from '../../src/stock/providers/freesound';
import { pexelsProvider } from '../../src/stock/providers/pexels';
import type { ProviderHit, StockCredentials, StockProvider } from '../../src/stock/stock-provider';
import { fakeClock } from '../helpers';
import { FREESOUND_FIXTURE, fixtureHttp, PEXELS_FIXTURE, PREVIEW_BYTES } from './fixtures';

const signal = new AbortController().signal;
const STARTED = Date.UTC(2026, 9, 14);

function keys(value: string | null): StockCredentials {
  return { get: async () => ok(value) };
}

function searchDeps(over: Partial<StockSearchDeps> & Pick<StockSearchDeps, 'http'>): StockSearchDeps {
  return {
    providers: [pexelsProvider],
    credentials: keys('pexels-user-key'),
    localOnly: () => false,
    cache: createMemoryStockCache(),
    clock: fakeClock(STARTED),
    alreadyImported: () => null,
    previews: createPreviewCache(),
    ...over,
  };
}

const routes = [
  { prefix: 'https://api.pexels.com/v1/videos/search', body: PEXELS_FIXTURE },
  { prefix: 'https://images.pexels.test/', body: PREVIEW_BYTES },
  { prefix: 'https://freesound.org/apiv2/search/', body: FREESOUND_FIXTURE },
];

describe('stock search', () => {
  it('returns an empty page and does not call out when there is no key', async () => {
    const http = fixtureHttp(routes);
    const search = createStockSearch(searchDeps({ http, credentials: keys(null) }));
    const page = await search.search({ query: 'ocean', kind: 'video' }, signal);
    expect(page.ok && page.value).toEqual({ items: [], providersOff: ['pexels'] });
    expect(http.calls).toHaveLength(0);
  });

  it('refuses Local only before any request', async () => {
    const http = fixtureHttp(routes);
    let asked = false;
    const credentials: StockCredentials = {
      get: async () => {
        asked = true;
        return ok('pexels-user-key');
      },
    };
    const search = createStockSearch(searchDeps({ http, credentials, localOnly: () => true }));
    const page = await search.search({ query: 'ocean', kind: 'video' }, signal);
    expect(page.ok).toBe(false);
    if (page.ok) return;
    expect(page.error.code).toBe('core.local_only');
    expect(page.error.params).toEqual({ what: 'stock' });
    expect(http.calls).toHaveLength(0);
    expect(asked).toBe(false);
  });

  it('serves a second search from the cache and strips control characters', async () => {
    const http = fixtureHttp(routes);
    const assetId = newId<'Asset'>();
    const search = createStockSearch(
      searchDeps({
        http,
        alreadyImported: (_provider, providerId) => (providerId === '101' ? assetId : null),
      }),
    );
    const first = await search.search({ query: 'ocean', kind: 'video', orientation: 'landscape' }, signal);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(stockSearchPageSchema.safeParse(first.value).success).toBe(true);
    expect(first.value.items.map((item) => item.providerId)).toEqual(['101', '202']);
    expect(first.value.items[0]).toMatchObject({
      title: 'Ada Lovelace',
      author: { name: 'Ada Lovelace', url: 'https://www.pexels.com/@ada' },
      renditionKey: '12',
      alreadyImported: assetId,
      licence: 'Pexels-Licence',
    });
    const title = first.value.items[0]?.title ?? '';
    expect(title.includes('<') || title.includes('>')).toBe(false);
    expect([...title].some((char) => char.charCodeAt(0) <= 0x1f || char.charCodeAt(0) === 0x7f)).toBe(false);
    expect(first.value.items[0]?.preview).toMatch(/^app:\/\/media\/stock\/[0-9a-f]{64}\.jpg$/);
    const calls = http.calls.length;
    expect(calls).toBeGreaterThan(0);
    const second = await search.search({ query: 'ocean', kind: 'video', orientation: 'landscape' }, signal);
    expect(second).toEqual(first);
    expect(http.calls).toHaveLength(calls);
  });

  it('reads a cache row that no longer parses as a miss, not a crash', async () => {
    const http = fixtureHttp(routes);
    const cache = createMemoryStockCache();
    const query = { query: 'ocean', kind: 'video' as const, page: 1 };
    const stale = JSON.stringify({ hits: [{ providerId: '101', title: 'no other field' }] });
    cache.put(searchCacheKey('pexels', query), 'pexels', stale, STARTED);
    const search = createStockSearch(searchDeps({ http, cache }));
    const page = await search.search(query, signal);
    expect(page.ok && page.value.items.map((item) => item.providerId)).toEqual(['101', '202']);
    expect(http.calls.length).toBeGreaterThan(0);
  });

  it('stops at the hourly bucket and when the provider reports no remaining calls', async () => {
    const http = fixtureHttp(routes);
    const quotaSearch = createStockSearch(searchDeps({ http, cache: createMemoryStockCache(0) }));
    let limited = false;
    for (let n = 0; n < 201; n += 1) {
      const page = await quotaSearch.search({ query: `clip ${n}`, kind: 'video' }, signal);
      if (!page.ok) {
        expect(n).toBe(200);
        expect(page.error).toMatchObject({
          code: 'library.stock_rate_limited',
          retryable: true,
          params: { provider: 'pexels', retryAfterSeconds: expect.any(Number) },
        });
        limited = true;
        break;
      }
    }
    expect(limited).toBe(true);
    const apiCalls = http.calls.filter((call) => call.url.startsWith('https://api.pexels.com/')).length;
    expect(apiCalls).toBe(200);

    const reset = Math.floor(Date.UTC(2026, 9, 14) / 1000) + 3600;
    const blocked = fixtureHttp([
      {
        prefix: 'https://api.pexels.com/v1/videos/search',
        body: PEXELS_FIXTURE,
        headers: { 'X-Ratelimit-Remaining': '0', 'X-Ratelimit-Reset': String(reset) },
      },
      { prefix: 'https://images.pexels.test/', body: PREVIEW_BYTES },
    ]);
    const time = fakeClock(STARTED);
    const search = createStockSearch(searchDeps({ http: blocked, clock: time }));
    expect((await search.search({ query: 'one', kind: 'video' }, signal)).ok).toBe(true);
    const after = await search.search({ query: 'two', kind: 'video' }, signal);
    expect(after.ok).toBe(false);
    if (after.ok) return;
    expect(after.error.code).toBe('library.stock_rate_limited');
    expect(blocked.calls.filter((call) => call.url.includes('api.pexels.com'))).toHaveLength(1);
    time.advance(3600 * 1000 + 1);
    expect((await search.search({ query: 'three', kind: 'video' }, signal)).ok).toBe(true);
  });

  it('concatenates every provider that serves the kind', async () => {
    const http = fixtureHttp(routes);
    const extraHit: ProviderHit = {
      provider: 'freesound',
      providerId: '9',
      kind: 'video',
      title: 'Extra\u0001 <clip>',
      authorName: 'Sam',
      authorUrl: null,
      pageUrl: 'https://freesound.org/people/sam/sounds/9/',
      licence: 'CC0-1.0',
      rawLicence: 'Creative Commons 0',
      seconds: 1,
      width: null,
      height: null,
      fps: null,
      renditionKey: 'preview-hq-mp3',
      downloadUrl: 'https://freesound.org/data/previews/9.mp3',
      previewUrl: null,
      previewRequired: false,
      attribution: '',
    };
    const extra: StockProvider = {
      id: 'freesound',
      kinds: ['video'],
      search: async () => ok({ hits: [extraHit], headers: {} }),
    };
    const search = createStockSearch(searchDeps({ http, providers: [pexelsProvider, extra] }));
    const page = await search.search({ query: 'ocean', kind: 'video' }, signal);
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    expect(page.value.items.map((item) => `${item.provider}:${item.providerId}`)).toEqual([
      'pexels:101',
      'pexels:202',
      'freesound:9',
    ]);
    expect(page.value.items[2]?.title).toBe('Extra clip');
    const sounds = createStockSearch(
      searchDeps({ http, providers: [pexelsProvider, freesoundProvider], credentials: { get: keyed } }),
    );
    const sound = await sounds.search({ query: 'rain', kind: 'soundEffect' }, signal);
    expect(sound.ok && sound.value.items.map((item) => item.providerId)).toEqual(['1', '2']);
    expect(sound.ok && sound.value.providersOff).toEqual([]);
  });

  it('drops the oldest preview when the injected byte cap is exceeded', async () => {
    const cache = createPreviewCache({ maxBytes: 10 });
    const first = await cache.put(Uint8Array.of(1, 2, 3, 4, 5, 6));
    const second = await cache.put(Uint8Array.of(7, 8, 9, 10, 11, 12));
    expect(cache.has(first)).toBe(false);
    expect(cache.has(second)).toBe(true);
    const again = await cache.put(Uint8Array.of(1, 2, 3, 4, 5, 6));
    expect(again).toBe(first);
    expect(cache.has(again)).toBe(true);
    expect(cache.has(second)).toBe(false);
  });
});

function keyed(provider: StockProviderId): AsyncResult<string | null> {
  return Promise.resolve(ok(provider === 'pexels' ? 'pexels-user-key' : 'freesound-user-token'));
}
