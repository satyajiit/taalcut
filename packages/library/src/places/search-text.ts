// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The words keyword search finds a clip by its place and trip (LIB1-PLACE): the city and region as the dataset
 * writes them, the country in each of the app's languages (so "Portugal", "पुर्तगाल" and "Portugal" in Spanish all find it), a
 * hint's countries the same way, and the trip's own name when the person gave one. Stored per asset in
 * `asset_places.search_text`, which migration 34's triggers put into its shots' FTS labels; FTS folds case and
 * accents itself.
 */
import type { Place, Trip } from '@taalcut/core';

/** The app's languages (D8): a country is findable by its name in each. */
const LANGUAGES = ['en', 'hi', 'es', 'pt-BR'] as const;
const MAX_LENGTH = 2000;

const displayNames = LANGUAGES.flatMap((locale) => {
  try {
    return [new Intl.DisplayNames([locale], { type: 'region' })];
  } catch {
    return [];
  }
});

/** The country's names in the app's languages, its code last ("PT"). */
export function countryWords(code: string): string[] {
  const names = displayNames.flatMap((names) => {
    try {
      const name = names.of(code);
      return name && name !== code ? [name] : [];
    } catch {
      return [];
    }
  });
  return [...names, code];
}

export function placeWords(place: Place | null): string[] {
  if (!place) return [];
  if (place.basis === 'zone') return place.countries.flatMap(countryWords);
  return [place.city, ...(place.region ? [place.region] : []), ...countryWords(place.country)];
}

export function tripWords(trip: Pick<Trip, 'name' | 'place' | 'hint'> | null): string[] {
  if (!trip) return [];
  const place = trip.place;
  const words =
    place === null
      ? trip.hint.flatMap(countryWords)
      : place.kind === 'countries'
        ? place.countries.flatMap(countryWords)
        : [place.name, ...countryWords(place.country)];
  return [...(trip.name ? [trip.name] : []), ...words];
}

/** One line of distinct words (case-insensitively), as long as FTS needs and no longer. */
export function searchTextOf(words: readonly string[]): string {
  const seen = new Set<string>();
  const kept: string[] = [];
  let length = 0;
  for (const word of words) {
    const key = word.normalize('NFC').toLocaleLowerCase('en');
    if (!word.trim() || seen.has(key)) continue;
    if (length + word.length + 1 > MAX_LENGTH) break;
    seen.add(key);
    kept.push(word.normalize('NFC'));
    length += word.length + 1;
  }
  return kept.join(' ');
}

/** The stored words for a clip with this place in this trip. */
export function assetSearchText(
  place: Place | null,
  trip: Pick<Trip, 'name' | 'place' | 'hint'> | null,
): string {
  return searchTextOf([...placeWords(place), ...tripWords(trip)]);
}
