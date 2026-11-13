// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Fan-out stock search. Local only fails the call (`core.local_only`) before
 * any request. A missing key is not an error: that provider is listed in
 * `providersOff` and nothing is fetched, so the UI can show the paused-keys
 * empty state. The gap offer turns that into `noStockKey`. Import does not
 * read the key: Pexels files are plain HTTPS links.
 */
import {
  err,
  LocalOnly,
  ok,
  stockResultSchema,
  stockSearchInputSchema,
  stockSearchPageSchema,
  ValidationError,
  type AssetId,
  type AsyncResult,
  type StockProviderId,
  type StockResult,
  type StockSearchPage,
} from '@taalcut/core';
import { z } from 'zod';
import { StockRateLimited, StockUnavailable } from '../errors';
import { plainText } from './plain-text';
import { SOUND_PLACEHOLDER, type PreviewCache } from './preview-cache';
import { createStockQuota, type StockQuota } from './quota';
import { searchCacheKey, stockItemCacheKey, type StockCache } from './search-cache';
import { parseJsonText } from '../db/json-text';
import {
  headerValue,
  providerHitSchema,
  type ProviderHit,
  type StockCredentials,
  type StockHttp,
  type StockProvider,
} from './stock-provider';

const PAGE_SIZE = 15;
const idle = new AbortController().signal;

export interface StockClock {
  now(): number;
}

export interface CachedStockHit extends ProviderHit {
  readonly preview: string;
}

export interface StockSearchDeps {
  readonly providers: readonly StockProvider[];
  readonly http: StockHttp;
  readonly credentials: StockCredentials;
  readonly localOnly: () => boolean;
  readonly cache: StockCache;
  readonly clock: StockClock;
  readonly alreadyImported: (provider: StockProviderId, providerId: string) => AssetId | null;
  readonly previews: PreviewCache;
  /** Tests inject a bucket; production uses the published limits. */
  readonly quota?: StockQuota;
}

export interface StockSearch {
  /** Page defaults to 1 inside the schema, so callers may omit it. */
  search(input: z.input<typeof stockSearchInputSchema>, signal?: AbortSignal): AsyncResult<StockSearchPage>;
}

const cachedHitsSchema = z.object({
  hits: z.array(providerHitSchema.extend({ preview: z.string().min(1).max(2048) })),
}) satisfies z.ZodType<{ hits: CachedStockHit[] }>;

function parseCached(body: string): CachedStockHit[] | null {
  return parseJsonText(cachedHitsSchema, body)?.hits ?? null;
}

function cleanHit(hit: ProviderHit, preview: string): CachedStockHit {
  const title = plainText(hit.title, 300);
  const authorName = plainText(hit.authorName, 200);
  return {
    ...hit,
    title: title || hit.providerId,
    authorName,
    attribution: plainText(hit.attribution, 500),
    preview,
  };
}

function toResult(hit: CachedStockHit, assetId: AssetId | null): StockResult | null {
  const authorUrl = hit.authorUrl && z.url().safeParse(hit.authorUrl).success ? hit.authorUrl : null;
  const result = stockResultSchema.safeParse({
    provider: hit.provider,
    providerId: hit.providerId,
    kind: hit.kind,
    title: hit.title,
    author: { name: hit.authorName.slice(0, 200), url: authorUrl },
    pageUrl: hit.pageUrl,
    licence: hit.licence,
    seconds: hit.seconds,
    width: hit.width,
    height: hit.height,
    fps: hit.fps,
    preview: hit.preview,
    renditionKey: hit.renditionKey,
    alreadyImported: assetId,
  });
  return result.success ? result.data : null;
}

/** What import reads back: the download URL never goes on the search result. */
export interface ResolvedRendition {
  readonly url: string;
  readonly licence: CachedStockHit['licence'];
  readonly rawLicence: string;
  readonly author: string | null;
  readonly authorUrl: string | null;
  readonly sourceUrl: string | null;
  readonly title: string;
  readonly kind: CachedStockHit['kind'];
  readonly attribution: string;
}

const resolvedSchema = z.object({
  url: z.url(),
  licence: z.enum(['Pexels-Licence', 'CC0-1.0', 'CC-BY-4.0']),
  rawLicence: z.string().max(200),
  author: z.string().max(200).nullable(),
  authorUrl: z.url().nullable(),
  sourceUrl: z.url().nullable(),
  title: z.string().max(300),
  kind: z.enum(['video', 'soundEffect']),
  attribution: z.string().max(500),
});

export function resolveCachedRendition(
  cache: StockCache,
  item: { readonly provider: StockProviderId; readonly providerId: string; readonly renditionKey: string },
  now: number,
): ResolvedRendition | null {
  const body = cache.get(stockItemCacheKey(item.provider, item.providerId, item.renditionKey), now);
  if (!body) return null;
  return parseJsonText(resolvedSchema, body);
}

function storeItem(cache: StockCache, provider: StockProviderId, hit: CachedStockHit, now: number): void {
  const resolved: ResolvedRendition = {
    url: hit.downloadUrl,
    licence: hit.licence,
    rawLicence: hit.rawLicence,
    author: hit.authorName || null,
    authorUrl: hit.authorUrl,
    sourceUrl: hit.pageUrl,
    title: hit.title,
    kind: hit.kind,
    attribution: hit.attribution,
  };
  cache.put(
    stockItemCacheKey(provider, hit.providerId, hit.renditionKey),
    provider,
    JSON.stringify(resolved),
    now,
  );
}

export function createStockSearch(deps: StockSearchDeps): StockSearch {
  const quota = deps.quota ?? createStockQuota();
  let placeholder: string | null = null;
  const placeholderUrl = async (): Promise<string> => {
    placeholder ??= await deps.previews.put(SOUND_PLACEHOLDER);
    return placeholder;
  };
  const withPreview = async (hit: ProviderHit, signal: AbortSignal): Promise<CachedStockHit | null> => {
    if (!hit.previewUrl) {
      if (hit.previewRequired) return null;
      return cleanHit(hit, await placeholderUrl());
    }
    const fetched = await deps.http.get(hit.previewUrl, {}, signal);
    if (!fetched.ok || fetched.value.status !== 200 || fetched.value.body.byteLength === 0) {
      return hit.previewRequired ? null : cleanHit(hit, await placeholderUrl());
    }
    return cleanHit(hit, await deps.previews.put(fetched.value.body));
  };
  return {
    async search(input, signal = idle) {
      // Local only refuses the search itself. No key does not: see the file comment.
      if (deps.localOnly()) return err(LocalOnly({ what: 'stock' }));
      const parsed = stockSearchInputSchema.safeParse(input);
      if (!parsed.success) return err(ValidationError({ field: 'query' }, { detail: 'stock search input' }));
      const query = parsed.data;
      const items: StockResult[] = [];
      const providersOff: StockProviderId[] = [];
      for (const provider of deps.providers) {
        if (!provider.kinds.includes(query.kind)) continue;
        const key = await deps.credentials.get(provider.id);
        if (!key.ok) return key;
        if (key.value === null) {
          providersOff.push(provider.id);
          continue;
        }
        const now = deps.clock.now();
        const cacheKey = searchCacheKey(provider.id, query);
        const cachedBody = deps.cache.get(cacheKey, now);
        let hits: CachedStockHit[];
        const cached = cachedBody ? parseCached(cachedBody) : null;
        if (cached) {
          hits = cached;
        } else {
          const taken = quota.tryTake(provider.id, now);
          if (!taken.ok) {
            return err(
              StockRateLimited({ provider: provider.id, retryAfterSeconds: taken.retryAfterSeconds }),
            );
          }
          const page = await provider.search(query, {
            http: deps.http,
            credential: key.value,
            signal,
            perPage: PAGE_SIZE,
          });
          if (!page.ok) return page;
          if (headerValue(page.value.headers, 'x-ratelimit-remaining') === '0') {
            quota.observe(provider.id, page.value.headers, deps.clock.now());
          }
          const prepared: CachedStockHit[] = [];
          for (const hit of page.value.hits) {
            const ready = await withPreview(hit, signal);
            if (ready) prepared.push(ready);
          }
          hits = prepared;
          const fetchedAt = deps.clock.now();
          deps.cache.put(cacheKey, provider.id, JSON.stringify({ hits }), fetchedAt);
          for (const hit of hits) storeItem(deps.cache, provider.id, hit, fetchedAt);
        }
        for (const hit of hits) {
          const result = toResult(hit, deps.alreadyImported(provider.id, hit.providerId));
          if (result) items.push(result);
        }
      }
      const page = stockSearchPageSchema.safeParse({ items: items.slice(0, 80), providersOff });
      return page.success ? ok(page.data) : err(StockUnavailable({ provider: providersOff[0] ?? 'pexels' }));
    },
  };
}
