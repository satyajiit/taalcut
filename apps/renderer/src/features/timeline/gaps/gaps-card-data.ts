// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { callRpc, err, ok, type StockResult } from '@taalcut/core';
import type { CardData } from '@taalcut/ui';
import type { Backend } from '../../../backend/backend';
import type { MediaUrls } from '../../../backend/media';

/**
 * P3-B8, P3-V18: stock search for a gap (library.stockSearch). No Pexels key isn't an error to the library (a page
 * with `providersOff`); a gap's search has nothing else to ask, so it says so as the library's own
 * `library.stock_no_key`, and the gap shows why in one line. With `media`, a preview is the URL the page can load
 * (main serves app://media/stock; the browser preview has none, so the tile keeps the viewer grey).
 */
export function gapsCardData(backend: Backend, media?: MediaUrls): Pick<CardData, 'stockSearch'> {
  return {
    async stockSearch(query) {
      const page = await callRpc(backend.library.stockSearch({ ...query, page: 1 }));
      if (!page.ok) return page;
      const items: readonly StockResult[] = page.value.items
        .filter((item) => item.kind === 'video')
        .map((item) => (media ? { ...item, preview: media.preview(item.preview) ?? '' } : item));
      if (items.length === 0 && page.value.providersOff.includes('pexels'))
        return err({
          code: 'library.stock_no_key',
          messageKey: 'errors.library.stock_no_key',
          retryable: false,
          params: { provider: 'pexels' },
        });
      return ok({ items });
    },
  };
}
