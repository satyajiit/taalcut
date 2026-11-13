// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What each filter means as the library contract's LibraryFilters, and the
 * words for each choice. Lengths and quality bands are the page's own
 * buckets: under 5 s (a cutaway), 5 to 30 s, over 30 s; good is the top 40%
 * of the quality score, great the top 20%.
 */
import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import type { LibraryFilters } from '@taalcut/core';
import type { Length, LibrarySearch, Period, Quality, Shape, Sort } from './library-search';

const DAY = 86_400_000;
const seconds = (s: number) => ({ value: s, rate: { num: 1, den: 1 } });

export function toLibraryFilters(search: LibrarySearch, now = Date.now()): LibraryFilters {
  const filters: LibraryFilters = {};
  if (search.shape) filters.orientations = [search.shape];
  if (search.length === 'short') filters.maxDuration = seconds(5);
  if (search.length === 'medium')
    Object.assign(filters, { minDuration: seconds(5), maxDuration: seconds(30) });
  if (search.length === 'long') filters.minDuration = seconds(30);
  if (search.quality) filters.minQuality = search.quality === 'great' ? 0.8 : 0.6;
  if (search.when) filters.capturedFrom = now - { week: 7, month: 30, year: 365 }[search.when] * DAY;
  if (search.source) filters.sourceIds = [search.source];
  if (search.action) filters.actions = [search.action];
  if (search.trip) filters.tripIds = [search.trip];
  // A country or a city counts only coordinates, never a time-zone guess (the library's place filter).
  if (search.country) filters.countries = [search.country];
  if (search.city) filters.cityIds = [search.city];
  if (search.filter === 'failed') filters.indexStates = ['failed'];
  return filters;
}

export const SHAPE_LABELS: Readonly<Record<Shape, MessageDescriptor>> = {
  portrait: msg`Vertical`,
  landscape: msg`Horizontal`,
  square: msg`Square`,
};

export const LENGTH_LABELS: Readonly<Record<Length, MessageDescriptor>> = {
  short: msg`Under 5 seconds`,
  medium: msg`5 to 30 seconds`,
  long: msg`Over 30 seconds`,
};

export const QUALITY_LABELS: Readonly<Record<Quality, MessageDescriptor>> = {
  good: msg`Good or better`,
  great: msg`Only the best`,
};

export const PERIOD_LABELS: Readonly<Record<Period, MessageDescriptor>> = {
  week: msg`Last 7 days`,
  month: msg`Last 30 days`,
  year: msg`Last year`,
};

export const SORT_LABELS: Readonly<Record<Sort, MessageDescriptor>> = {
  captured: msg`Newest first`,
  added: msg`Recently added`,
  duration: msg`Longest first`,
  quality: msg`Best quality first`,
};
