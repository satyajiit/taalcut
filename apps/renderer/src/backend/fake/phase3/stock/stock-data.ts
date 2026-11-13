// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* eslint-disable lingui/no-unlocalized-strings -- provider titles and author names: data, never translated */

/**
 * The stock fake's Pexels videos (P3-V18): a fixed catalogue, searched by the words of a query, each with the
 * library asset it becomes once imported. The asset id is a pure function of the item, so the Make fakes'
 * timeline.fillGap knows a stock video's length without holding the stock fake (stockMediaOf).
 */
import {
  RationalTime,
  type AssetId,
  type StockProvenance,
  type StockResult,
  type StockSearchInput,
  type TimeRange,
} from '@taalcut/core';
import { KIND } from '../../library/assets';
import { fakeUlid, ulidNumber } from '../../library/seed';

interface CatalogueItem {
  readonly id: string;
  readonly title: string;
  readonly author: string;
  readonly words: readonly string[];
  readonly seconds: number;
  readonly portrait: boolean;
}

const CATALOGUE: readonly CatalogueItem[] = [
  {
    id: '3195394',
    title: 'Coffee poured into a cup',
    author: 'Ketut Subiyanto',
    words: ['coffee', 'pour', 'cup', 'close'],
    seconds: 12,
    portrait: true,
  },
  {
    id: '2909914',
    title: 'Barista pouring milk',
    author: 'Chevanon Photography',
    words: ['coffee', 'pour', 'milk', 'close'],
    seconds: 9,
    portrait: true,
  },
  {
    id: '4109264',
    title: 'Espresso dripping',
    author: 'Anna Tarazevich',
    words: ['coffee', 'espresso', 'close', 'detail'],
    seconds: 15,
    portrait: true,
  },
  {
    id: '6612440',
    title: 'Pouring chai at a stall',
    author: 'Rachel Claire',
    words: ['tea', 'chai', 'pour', 'stall', 'market', 'hands'],
    seconds: 8,
    portrait: true,
  },
  {
    id: '1918465',
    title: 'Waves washing over feet',
    author: 'Ruvim Miksanskiy',
    words: ['waves', 'feet', 'sea', 'beach', 'shore', 'slow'],
    seconds: 14,
    portrait: true,
  },
  {
    id: '2499611',
    title: 'Foam running up the sand',
    author: 'Engin Akyurt',
    words: ['waves', 'sea', 'beach', 'foam', 'sand'],
    seconds: 11,
    portrait: true,
  },
  {
    id: '3576378',
    title: 'Walking barefoot in the surf',
    author: 'Taryn Elliott',
    words: ['feet', 'waves', 'beach', 'walking', 'water'],
    seconds: 10,
    portrait: true,
  },
  {
    id: '1093662',
    title: 'The sea at sunset',
    author: 'Pok Rie',
    words: ['sea', 'waves', 'sunset', 'blue', 'water'],
    seconds: 18,
    portrait: false,
  },
  {
    id: '5737514',
    title: 'Bright fabric hanging at a stall',
    author: 'Yan Krukau',
    words: ['fabric', 'colours', 'stall', 'market', 'push'],
    seconds: 9,
    portrait: true,
  },
  {
    id: '4622902',
    title: 'Silk scarves moving in the wind',
    author: 'Olia Danilevich',
    words: ['fabric', 'colours', 'silk', 'slow'],
    seconds: 12,
    portrait: true,
  },
  {
    id: '3571264',
    title: 'Spice stall in many colours',
    author: 'Mikhail Nilov',
    words: ['colours', 'stall', 'market', 'spice', 'food'],
    seconds: 9,
    portrait: true,
  },
  {
    id: '2795750',
    title: 'Night market with string lights',
    author: 'Kelly',
    words: ['market', 'night', 'lights', 'lane', 'skyline'],
    seconds: 16,
    portrait: true,
  },
  {
    id: '6740321',
    title: 'Hands counting coins',
    author: 'Karolina Grabowska',
    words: ['hands', 'coins', 'change', 'money', 'detail'],
    seconds: 7,
    portrait: true,
  },
  {
    id: '4434286',
    title: 'Fireworks over a river',
    author: 'Aleksandar Pasaric',
    words: ['fireworks', 'river', 'night', 'lights'],
    seconds: 4,
    portrait: true,
  },
];

/** Past every fake library clip (DEFAULT_ASSET_COUNT is 5,000): a stock video's own asset id. */
const STOCK_ASSET_BASE = 900_000;
const FPS = 30;

/** A fixed hex digest per item for its app://media/stock preview (the CSP's pattern). */
function digest(id: string): string {
  let hex = '';
  let seed = Number(id);
  while (hex.length < 64) {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    hex += seed.toString(16).padStart(8, '0');
  }
  return hex.slice(0, 64);
}

function resultOf(item: CatalogueItem, alreadyImported: AssetId | null): StockResult {
  return {
    provider: 'pexels',
    providerId: item.id,
    kind: 'video',
    title: item.title,
    author: { name: item.author, url: null },
    pageUrl: `https://www.pexels.com/video/${item.id}/`,
    licence: 'Pexels-Licence',
    seconds: item.seconds,
    width: item.portrait ? 1080 : 1920,
    height: item.portrait ? 1920 : 1080,
    fps: FPS,
    preview: `app://media/stock/${digest(item.id)}.jpg`,
    renditionKey: item.portrait ? 'hd-portrait' : 'hd',
    alreadyImported,
  };
}

/** Results for a query, best match first, as one page of Pexels answers (15 at most). */
export function searchCatalogue(
  input: Pick<StockSearchInput, 'query' | 'orientation' | 'minSeconds' | 'maxSeconds'>,
  imported: (providerId: string) => AssetId | null,
): StockResult[] {
  const words = input.query
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);
  return CATALOGUE.map((item) => ({ item, score: words.filter((word) => item.words.includes(word)).length }))
    .filter(({ item, score }) => {
      if (score === 0) return false;
      if (input.orientation === 'portrait' && !item.portrait) return false;
      if (input.orientation === 'landscape' && item.portrait) return false;
      if (input.minSeconds && item.seconds < input.minSeconds) return false;
      return !(input.maxSeconds && item.seconds > input.maxSeconds);
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 15)
    .map(({ item }) => resultOf(item, imported(item.id)));
}

/** The catalogue item for a provider id and rendition, if the fake has it. */
export function catalogueItem(providerId: string, renditionKey: string): CatalogueItem | undefined {
  const item = CATALOGUE.find((entry) => entry.id === providerId);
  return item && resultOf(item, null).renditionKey === renditionKey ? item : undefined;
}

/** Where an imported stock video came from, as the library records it (library.credits reads it). */
export function stockProvenance(item: CatalogueItem, fetchedAt: number): StockProvenance {
  return {
    kind: 'stock',
    provider: 'pexels',
    providerAssetId: item.id,
    licence: 'Pexels-Licence',
    rawLicence: 'Pexels License',
    author: item.author,
    authorUrl: null,
    sourceUrl: `https://www.pexels.com/video/${item.id}/`,
    attribution: '',
    fetchedAt,
  };
}

/** The library asset an imported stock video becomes. */
export function stockAssetId(providerId: string): AssetId {
  return fakeUlid<'Asset'>(
    KIND.asset,
    STOCK_ASSET_BASE + CATALOGUE.findIndex((item) => item.id === providerId),
  );
}

/** An imported stock video's media (its whole length, at its own rate), for timeline.fillGap; else undefined. */
export function stockMediaOf(assetId: string): { readonly available: TimeRange } | undefined {
  const n = ulidNumber(assetId, KIND.asset);
  const item = n === null ? undefined : CATALOGUE[n - STOCK_ASSET_BASE];
  if (!item) return undefined;
  const rate = { num: FPS, den: 1 };
  return {
    available: { start: RationalTime.zero(rate), duration: RationalTime.of(item.seconds * FPS, rate) },
  };
}
