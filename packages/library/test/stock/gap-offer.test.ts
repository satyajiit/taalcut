// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { ok, stockResultSchema } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { offerStock } from '../../src/stock/gap-offer';
import { createPreviewCache } from '../../src/stock/preview-cache';
import { defaultStockProviders } from '../../src/stock/providers';
import { createMemoryStockCache } from '../../src/stock/search-cache';
import { createStockSearch } from '../../src/stock/stock-search';
import type { StockCredentials } from '../../src/stock/stock-provider';
import { fixtureHttp, PEXELS_FIXTURE, PREVIEW_BYTES } from './fixtures';

const signal = new AbortController().signal;
const routes = [
  { prefix: 'https://api.pexels.com/v1/videos/search', body: PEXELS_FIXTURE },
  { prefix: 'https://images.pexels.test/', body: PREVIEW_BYTES },
];

function offer(localOnly: boolean, key: string | null) {
  const http = fixtureHttp(routes);
  const providers = defaultStockProviders({ freesound: false });
  const credentials: StockCredentials = { get: async () => ok(key) };
  const search = createStockSearch({
    providers,
    http,
    credentials,
    localOnly: () => localOnly,
    cache: createMemoryStockCache(),
    clock: { now: () => Date.UTC(2026, 9, 14) },
    alreadyImported: () => null,
    previews: createPreviewCache(),
  });
  return { http, result: offerStock('ocean', { search, localOnly: () => localOnly, providers, signal }) };
}

describe('stock gap offer', () => {
  it('records local only and does not search', async () => {
    const { http, result } = offer(true, 'pexels-user-key');
    expect(await result).toEqual({
      ok: true,
      value: { option: null, unavailable: { kind: 'stock', reason: 'localOnly' }, page: null },
    });
    expect(http.calls).toHaveLength(0);
  });

  it('records a missing key without calling the provider', async () => {
    const { http, result } = offer(false, null);
    const page = await result;
    expect(page.ok && page.value.option).toBeNull();
    expect(page.ok && page.value.unavailable).toEqual({ kind: 'stock', reason: 'noStockKey' });
    expect(http.calls).toHaveLength(0);
  });

  it('offers the stock option and items that match the result schema when a key is set', async () => {
    const { http, result } = offer(false, 'pexels-user-key');
    const page = await result;
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    expect(page.value.option).toEqual({ kind: 'stock', query: 'ocean' });
    expect(page.value.unavailable).toBeNull();
    expect(page.value.page?.items.length).toBeGreaterThan(0);
    for (const item of page.value.page?.items ?? []) {
      expect(stockResultSchema.safeParse(item).success).toBe(true);
    }
    expect(http.calls.some((call) => call.url.startsWith('https://api.pexels.com/'))).toBe(true);
  });

  it('treats a build with no Pexels provider as stock off', async () => {
    const http = fixtureHttp(routes);
    const search = createStockSearch({
      providers: [],
      http,
      credentials: { get: async () => ok('pexels-user-key') },
      localOnly: () => false,
      cache: createMemoryStockCache(),
      clock: { now: () => 0 },
      alreadyImported: () => null,
      previews: createPreviewCache(),
    });
    const page = await offerStock('ocean', { search, localOnly: () => false, providers: [], signal });
    expect(page.ok && page.value).toEqual({
      option: null,
      unavailable: { kind: 'stock', reason: 'stockOff' },
      page: null,
    });
    expect(http.calls).toHaveLength(0);
  });
});
