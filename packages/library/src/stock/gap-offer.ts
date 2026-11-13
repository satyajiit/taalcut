// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Stock offered to gap handling. No UI. A video gap only asks Pexels: Freesound
 * being off is not a video-gap problem. Local only and a missing Pexels key
 * record why, and do not search.
 */
import { err, ok, type AsyncResult, type StockSearchPage } from '@taalcut/core';
import type { StockSearch } from './stock-search';
import type { StockProvider } from './stock-provider';

export interface StockOffer {
  readonly option: { readonly kind: 'stock'; readonly query: string } | null;
  readonly unavailable: {
    readonly kind: 'stock';
    readonly reason: 'localOnly' | 'noStockKey' | 'stockOff';
  } | null;
  readonly page: StockSearchPage | null;
}

export async function offerStock(
  query: string,
  deps: {
    readonly search: StockSearch;
    readonly localOnly: () => boolean;
    readonly providers: readonly StockProvider[];
    readonly signal?: AbortSignal;
  },
): AsyncResult<StockOffer> {
  if (deps.localOnly())
    return ok({ option: null, unavailable: { kind: 'stock', reason: 'localOnly' }, page: null });
  const pexels = deps.providers.find((provider) => provider.id === 'pexels');
  if (!pexels) return ok({ option: null, unavailable: { kind: 'stock', reason: 'stockOff' }, page: null });
  const page = await deps.search.search({ query, kind: 'video' }, deps.signal);
  if (!page.ok) {
    if (page.error.code === 'core.local_only') {
      return ok({ option: null, unavailable: { kind: 'stock', reason: 'localOnly' }, page: null });
    }
    return err(page.error);
  }
  // No key is a page (providersOff), not a thrown error. The gap card uses noStockKey.
  if (page.value.providersOff.includes('pexels')) {
    return ok({ option: null, unavailable: { kind: 'stock', reason: 'noStockKey' }, page: page.value });
  }
  return ok({ option: { kind: 'stock', query }, unavailable: null, page: page.value });
}
