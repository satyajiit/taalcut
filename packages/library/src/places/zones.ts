// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A UTC offset as a country hint (LIB1-PLACE): the countries whose time zones kept that offset at that moment
 * (summer time included, from the system's own zone rules through Intl), the likeliest first by the people living in
 * their cities there. −03:00 in March 2026 is Brazil, Argentina and Chile; +00:00 that week is the UK, Côte
 * d'Ivoire and Morocco (in Ramadan), Portugal further down. A hint is never a place: the window says "probably".
 */
import { PLACE_HINT_MAX } from '@taalcut/core';
import type { PlacesDataset } from './dataset';

const formatters = new Map<string, Intl.DateTimeFormat | null>();

function formatterOf(zone: string): Intl.DateTimeFormat | null {
  let formatter = formatters.get(zone);
  if (formatter === undefined) {
    try {
      formatter = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' });
    } catch {
      formatter = null; // A zone this system's rules don't know.
    }
    formatters.set(zone, formatter);
  }
  return formatter;
}

/** The zone's offset from UTC at `at`, in minutes east; null for a zone the system doesn't know. */
export function zoneOffsetMin(zone: string, at: number): number | null {
  const formatter = formatterOf(zone);
  if (!formatter) return null;
  const name = formatter.formatToParts(at).find((part) => part.type === 'timeZoneName')?.value ?? '';
  const match = /^GMT(?:([+-])(\d{1,2})(?::(\d{2}))?)?$/.exec(name);
  if (!match) return null;
  if (!match[1]) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3] ?? 0);
  return match[1] === '-' ? -minutes : minutes;
}

/** A country under this share of the likeliest one's people isn't named. */
const MIN_SHARE = 0.01;

export interface ZoneHints {
  /** Up to PLACE_HINT_MAX country codes, likeliest first; empty when no zone kept the offset then. */
  countriesAt(offsetMin: number, at: number): string[];
}

export function createZoneHints(dataset: PlacesDataset): ZoneHints {
  const { header } = dataset;
  const byZone = new Map<number, [number, number][]>();
  for (const [zone, country, people] of header.zonePeople) {
    const list = byZone.get(zone) ?? [];
    list.push([country, people]);
    byZone.set(zone, list);
  }
  // Offsets change twice a year at most: one answer per offset and UTC day.
  const cache = new Map<string, string[]>();
  return {
    countriesAt(offsetMin, at) {
      const key = `${offsetMin}:${Math.floor(at / 86_400_000)}`;
      const known = cache.get(key);
      if (known) return known;
      const people = new Map<number, number>();
      for (const [zone, countries] of byZone) {
        if (zoneOffsetMin(header.zones[zone] ?? '', at) !== offsetMin) continue;
        for (const [country, n] of countries) people.set(country, (people.get(country) ?? 0) + n);
      }
      const ranked = [...people].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
      const top = ranked[0]?.[1] ?? 0;
      const countries = ranked
        .filter(([, n]) => n >= top * MIN_SHARE)
        .slice(0, PLACE_HINT_MAX)
        .map(([country]) => header.countries[country] ?? 'ZZ');
      if (cache.size > 4096) cache.clear();
      cache.set(key, countries);
      return countries;
    },
  };
}
