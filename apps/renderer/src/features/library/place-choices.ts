// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The Trip and Place filters' choices (LIB1-FIND), from place's reads: every trip, newest first, by its name (the
 * person's, shown as written, or its automatic one: "Portugal · Sep 2026"); every country the clips were filmed in
 * by coordinates, most clips first, named in the UI's language, each followed by its cities as the dataset names
 * them. A time-zone guess is never a place here, as it never is for the filters.
 */
import type { I18n } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import type { PlaceCount, Trip } from '@taalcut/core';
import type { FilterOption } from './filter-pill';
import { countryName, tripName } from './trips/trip-words';

/** The trips, and a chosen one no longer listed (renamed away, or gone with its last clip). */
export function tripChoices(
  i18n: I18n,
  trips: readonly Trip[],
  chosen: string | undefined,
): FilterOption<string>[] {
  const options: FilterOption<string>[] = trips.map((trip) => ({
    value: trip.id,
    label: tripName(i18n, trip),
    ...(trip.name ? { raw: true } : {}),
  }));
  if (chosen && !trips.some((trip) => trip.id === chosen))
    options.push({ value: chosen, label: i18n._(msg`Another trip`) });
  return options;
}

/**
 * Each country, most clips first, then its cities one level in, most clips first; a chosen place no longer listed
 * stays offered. The library lists a country's own row before its cities; a list of cities alone gets its countries.
 */
export function placeChoices(
  i18n: I18n,
  places: readonly PlaceCount[],
  chosen: string | undefined,
): FilterOption<string>[] {
  const countries = new Map<string, { clips: number; own: boolean; cities: PlaceCount[] }>();
  for (const place of places) {
    const country = countries.get(place.country) ?? { clips: 0, own: false, cities: [] };
    if (place.cityId === null) Object.assign(country, { clips: place.clips, own: true });
    else {
      country.cities.push(place);
      if (!country.own) country.clips += place.clips;
    }
    countries.set(place.country, country);
  }
  const options: FilterOption<string>[] = [];
  for (const [code, country] of [...countries].sort((a, b) => b[1].clips - a[1].clips)) {
    // Intl's name for the country, already in the UI's language: data, never the catalogue's (translate="no").
    options.push({ value: code, label: countryName(i18n, code), raw: true });
    for (const city of [...country.cities].sort((a, b) => b.clips - a.clips))
      options.push({ value: String(city.cityId), label: city.city ?? code, raw: true, inset: true });
  }
  if (chosen && !options.some((option) => option.value === chosen))
    options.push(
      /^[A-Z]{2}$/.test(chosen)
        ? { value: chosen, label: countryName(i18n, chosen), raw: true }
        : { value: chosen, label: i18n._(msg`Another place`) },
    );
  return options;
}
