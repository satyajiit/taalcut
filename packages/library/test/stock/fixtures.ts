// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { readFileSync } from 'node:fs';
import { err, ok, type AsyncResult } from '@taalcut/core';
import { StockUnavailable } from '../../src/errors';
import { stockItemCacheKey, type StockCache } from '../../src/stock/search-cache';
import type { StockHttp, StockHttpResponse, StockHttpStream } from '../../src/stock/stock-provider';

export const PEXELS_FIXTURE = readFileSync(new URL('./fixtures/pexels-videos.json', import.meta.url));
export const FREESOUND_FIXTURE = readFileSync(new URL('./fixtures/freesound-search.json', import.meta.url));
export const PREVIEW_BYTES = Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8);

export interface RecordedCall {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}

/** The recorded body in `size`-byte chunks, as a streamed download arrives. */
export async function* chunked(body: Uint8Array, size = 4): AsyncIterable<Uint8Array> {
  for (let offset = 0; offset < body.byteLength; offset += size) yield body.subarray(offset, offset + size);
}

/** Routes a URL prefix to a recorded body. Anything else is stock_unavailable (no live call). */
export function fixtureHttp(
  routes: readonly {
    readonly prefix: string;
    readonly status?: number;
    readonly body: Uint8Array;
    readonly headers?: Record<string, string>;
  }[],
): StockHttp & { readonly calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  return {
    calls,
    async get(url, headers): AsyncResult<StockHttpResponse> {
      calls.push({ url, headers: { ...headers } });
      const route = routes.find((candidate) => url.startsWith(candidate.prefix));
      if (!route) return err(StockUnavailable({ provider: 'pexels' }));
      return ok({ status: route.status ?? 200, headers: route.headers ?? {}, body: route.body });
    },
    async stream(url, headers): AsyncResult<StockHttpStream> {
      calls.push({ url, headers: { ...headers } });
      const route = routes.find((candidate) => url.startsWith(candidate.prefix));
      if (!route) return err(StockUnavailable({ provider: 'pexels' }));
      return ok({ status: route.status ?? 200, headers: route.headers ?? {}, body: chunked(route.body) });
    },
  };
}

/** The search cache's entry for Pexels video 101 (rendition 15), as a search left it at `now`. */
export function seedPexelsClip(
  cache: StockCache,
  now: number,
  url: string,
  rawLicence = 'Pexels-Licence',
): void {
  cache.put(
    stockItemCacheKey('pexels', '101', '15'),
    'pexels',
    JSON.stringify({
      url,
      licence: 'Pexels-Licence',
      rawLicence,
      author: 'Ada',
      authorUrl: 'https://www.pexels.com/@ada',
      sourceUrl: 'https://www.pexels.com/video/101/',
      title: 'Waves',
      kind: 'video',
      attribution: '',
    }),
    now,
  );
}
