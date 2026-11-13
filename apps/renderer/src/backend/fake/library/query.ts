// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Browse and search over the fake library, by the library contract's rules:
 * filters (missing originals and trashed clips hidden unless asked for),
 * sorts with a stable tie-break, an opaque cursor, and keyword search over
 * descriptions, speech and on-screen text with the reason each hit matched.
 * The real search fuses vectors and keywords; this one is keywords only and
 * says so through the same `matchedBy` and `snippet` fields.
 */
import type { AssetSummary, LibraryFilters, SearchHit, SearchResult } from '@taalcut/core';
import type { FakeAsset } from './assets';
import { actionsOf, matchesFindFilters } from './fake-actions';
import { SCENES, SPEECH } from './scenes';
import { placeWords } from './fake-places';

export type LibrarySort = 'captured' | 'added' | 'duration' | 'quality';

const seconds = (time: { value: number; rate: { num: number; den: number } } | null | undefined) =>
  time ? (time.value * time.rate.den) / time.rate.num : 0;

export function matchesFilters(asset: AssetSummary, filters: LibraryFilters = {}): boolean {
  const availability = filters.availability ?? ['online', 'offline', 'icloud_placeholder'];
  if (!availability.includes(asset.availability)) return false;
  if (asset.trashed && !filters.includeTrashed) return false;
  if (filters.kinds && !filters.kinds.includes(asset.kind)) return false;
  if (filters.orientations && (!asset.orientation || !filters.orientations.includes(asset.orientation)))
    return false;
  const length = seconds(asset.duration);
  if (filters.minDuration && length < seconds(filters.minDuration)) return false;
  if (filters.maxDuration && length > seconds(filters.maxDuration)) return false;
  if (filters.minQuality !== undefined && (asset.quality ?? 0) < filters.minQuality) return false;
  const when = asset.capturedAt ?? asset.addedAt;
  if (filters.capturedFrom !== undefined && when < filters.capturedFrom) return false;
  if (filters.capturedTo !== undefined && when > filters.capturedTo) return false;
  if (filters.sourceIds && !asset.sourceIds.some((id) => filters.sourceIds!.includes(id))) return false;
  if (filters.languages && (!asset.language || !filters.languages.includes(asset.language))) return false;
  if (filters.hasSpeech !== undefined && (asset.language !== null) !== filters.hasSpeech) return false;
  if (filters.indexStates && !filters.indexStates.includes(asset.index.state)) return false;
  return true;
}

function sortKey(asset: AssetSummary, sort: LibrarySort): number {
  switch (sort) {
    case 'captured':
      return asset.capturedAt ?? asset.addedAt;
    case 'added':
      return asset.addedAt;
    case 'duration':
      return seconds(asset.duration);
    case 'quality':
      return asset.quality ?? -1;
  }
}

export interface BrowseInput {
  readonly filters?: LibraryFilters;
  readonly sort: LibrarySort;
  readonly direction: 'asc' | 'desc';
  readonly cursor?: string;
  readonly limit: number;
}

/** Sorted, filtered ids are cached per query, so paging 5,000 clips doesn't re-sort for every page. */
export function createBrowser(assets: () => readonly FakeAsset[]) {
  let cache: { key: string; list: AssetSummary[] } | null = null;
  return {
    invalidate() {
      cache = null;
    },
    browse(input: BrowseInput) {
      const key = JSON.stringify([input.filters ?? {}, input.sort, input.direction]);
      if (cache?.key !== key) {
        const sign = input.direction === 'asc' ? 1 : -1;
        const list = assets()
          .filter(
            (asset) =>
              matchesFilters(asset.summary, input.filters) && matchesFindFilters(asset, input.filters),
          )
          .map((asset) => asset.summary);
        list.sort(
          (a, b) => sign * (sortKey(a, input.sort) - sortKey(b, input.sort)) || (a.id < b.id ? sign : -sign),
        );
        cache = { key, list };
      }
      const offset = Math.max(0, Number.parseInt(input.cursor ?? '0', 10) || 0);
      const items = cache.list.slice(offset, offset + input.limit);
      const next = offset + items.length;
      return {
        items,
        total: cache.list.length,
        ...(next < cache.list.length ? { nextCursor: String(next) } : {}),
      };
    },
  };
}

/** Lower case, accents folded, so "café" finds "cafe". */
function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** Small words a query is full of; they don't make a match on their own. */
const STOP = new Set(['a', 'an', 'the', 'of', 'in', 'on', 'at', 'with', 'and', 'or', 'to', 'some', 'my']);

function terms(query: string): string[] {
  return fold(query)
    .split(/[^\p{L}\p{N}₹]+/u)
    .filter((term) => term.length > 1 && !STOP.has(term));
}

type Field = 'description' | 'transcript' | 'onScreenText';

function findIn(text: string, words: readonly string[]): [number, number][] {
  const folded = fold(text);
  const found: [number, number][] = [];
  for (const word of words) {
    const at = folded.indexOf(word);
    if (at >= 0) found.push([at, at + word.length]);
  }
  return found.sort((a, b) => a[0] - b[0]);
}

/** Every term of the query must appear in one of the clip's texts; the best field gives the snippet. */
export function search(
  assets: readonly FakeAsset[],
  query: string,
  filters: LibraryFilters | undefined,
  limit: number,
  shotFor: (asset: FakeAsset) => SearchHit['shot'] | null,
): SearchResult {
  const started = performance.now();
  const words = terms(query);
  const hits: SearchHit[] = [];
  if (words.length === 0) return { hits, tookMs: 0 };
  for (const asset of assets) {
    if (!matchesFilters(asset.summary, filters) || !matchesFindFilters(asset, filters)) continue;
    if (asset.summary.description === null) continue;
    const scene = SCENES[asset.extras.scene]!;
    const speech =
      asset.extras.speech !== null && asset.summary.language
        ? SPEECH[asset.extras.speech]!.lines[asset.extras.n % SPEECH[asset.extras.speech]!.lines.length]!
        : '';
    const fields: [Field, string][] = [
      [
        'description',
        `${scene.description} ${scene.objects.join(' ')} ${actionsOf(asset).join(' ')} ${scene.place ?? ''} ${placeWords(asset.summary)}`,
      ],
      ['transcript', speech],
      ['onScreenText', scene.onScreenText ?? ''],
    ];
    const all = fold(fields.map(([, text]) => text).join(' '));
    if (!words.every((word) => all.includes(word))) continue;
    const matched = fields.filter(([, text]) => findIn(text, words).length > 0);
    const shot = shotFor(asset);
    if (!shot) continue;
    // As the real search's snippet: the passage with the most of the words, from the description itself (not its
    // objects or place, which are labels), what is said or what is on screen; none when only a label matched.
    const passages: [Field, string][] = [['description', scene.description], ...fields.slice(1)];
    const best = passages
      .map(([field, text]) => ({ field, text, marks: findIn(text, words) }))
      .filter((passage) => passage.marks.length > 0)
      .sort((a, b) => b.marks.length - a.marks.length)[0];
    hits.push({
      shot,
      asset: asset.summary,
      score: Math.min(1, 0.4 + (asset.summary.quality ?? 0.5) * 0.6),
      matchedBy: matched.map(([name]) => (name === 'transcript' ? 'speech' : name)),
      ...(best
        ? {
            snippet: {
              field: best.field,
              text: best.text.slice(0, 400),
              highlights: best.marks.slice(0, 20),
            },
          }
        : {}),
    });
    if (hits.length >= limit * 4) break;
  }
  hits.sort((a, b) => b.score - a.score);
  return { hits: hits.slice(0, limit), tookMs: Math.round(performance.now() - started) };
}

/** Clips of the same scene as the shot's clip, best first: what the vector search would call similar. */
export function similar(
  assets: readonly FakeAsset[],
  of: FakeAsset,
  filters: LibraryFilters | undefined,
  limit: number,
  shotFor: (asset: FakeAsset) => SearchHit['shot'] | null,
): SearchResult {
  const hits: SearchHit[] = [];
  for (const asset of assets) {
    if (asset === of || asset.extras.scene !== of.extras.scene) continue;
    if (!matchesFilters(asset.summary, filters) || !matchesFindFilters(asset, filters)) continue;
    if (asset.summary.description === null) continue;
    const shot = shotFor(asset);
    if (shot)
      hits.push({
        shot,
        asset: asset.summary,
        score: 0.5 + (asset.summary.quality ?? 0) / 2,
        matchedBy: ['visual'],
      });
  }
  hits.sort((a, b) => b.score - a.score);
  return { hits: hits.slice(0, limit), tookMs: 4 };
}
