// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A clip's place and a trip in the window's words (LIB1-PLACE). Countries come as ISO codes and are named by Intl in
 * the UI's language ("Portugal", "पुर्तगाल"); cities and regions are the dataset's names, shown as they are. A trip
 * without a place reads "Trip" and its month. The components (trip-title.tsx, clip-place.tsx) put the words around
 * them.
 */
import type { I18n } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import type { Trip, TripPlace } from '@taalcut/core';

const regionNames = new Map<string, Intl.DisplayNames | null>();

function namesFor(locale: string): Intl.DisplayNames | null {
  let names = regionNames.get(locale);
  if (names === undefined) {
    try {
      names = new Intl.DisplayNames([locale, 'en'], { type: 'region' });
    } catch {
      names = null;
    }
    regionNames.set(locale, names);
  }
  return names;
}

/** "PT" → "Portugal" in the UI's language; the code itself when Intl has no name. */
export function countryName(i18n: I18n, code: string): string {
  try {
    return namesFor(i18n.locale)?.of(code) ?? code;
  } catch {
    return code;
  }
}

/** "Portugal and Spain", or with `or`, "Brazil, Argentina or Chile". */
export function countryList(i18n: I18n, codes: readonly string[], or = false): string {
  const names = codes.map((code) => countryName(i18n, code));
  try {
    return new Intl.ListFormat([i18n.locale, 'en'], { type: or ? 'disjunction' : 'conjunction' }).format(
      names,
    );
  } catch {
    return names.join(', ');
  }
}

/** A UTC offset as people write it: "UTC+1", "UTC+5:30", "UTC−3", "UTC+0". */
export function offsetWords(minutes: number): string {
  const sign = minutes < 0 ? '−' : '+';
  const abs = Math.abs(minutes);
  const hours = Math.floor(abs / 60);
  const rest = abs % 60;
  return `UTC${sign}${hours}${rest ? `:${String(rest).padStart(2, '0')}` : ''}`;
}

/** What a trip's automatic name says before its month: "Goa", "Portugal", "Portugal and Spain". */
export function tripPlaceWords(i18n: I18n, place: TripPlace): string {
  return place.kind === 'countries' ? countryList(i18n, place.countries) : place.name;
}

/** "Oct 2026", from the trip's "2026-10". */
export function tripMonth(i18n: I18n, month: string): string {
  const [year, number] = month.split('-').map(Number) as [number, number];
  return i18n.date(new Date(year, number - 1, 1), { month: 'short', year: 'numeric' });
}

/** The person's name for the trip, else its automatic one: "Portugal · Mar 2026", or "Trip · Mar 2026". */
export function tripName(i18n: I18n, trip: Pick<Trip, 'name' | 'place' | 'month'>): string {
  if (trip.name) return trip.name;
  const month = tripMonth(i18n, trip.month);
  if (!trip.place) return i18n._(msg`Trip · ${month}`);
  const place = tripPlaceWords(i18n, trip.place);
  return i18n._(msg`${place} · ${month}`);
}
