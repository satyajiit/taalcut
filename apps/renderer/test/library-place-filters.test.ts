// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LIB1-FIND in the window: the Trip and Place filters live in the URL (`?trip=<id>`, `?country=PT`, `?city=<id>`),
 * become the library's `tripIds`, `countries` and `cityIds`, count for Clear filters, and list place's trips and
 * places: a country, then its cities one level in, by coordinates only. The fake library filters by them as the real
 * one does: a time-zone guess is never in a country or a city.
 */
import { setupI18n } from '@lingui/core';
import { callRpc, newId, type PlaceCount, type Trip } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createFakeBackend } from '../src/backend/fake/fake-backend';
import { toLibraryFilters } from '../src/features/library/filters';
import { hasFilters, NO_FILTERS, parseLibrarySearch } from '../src/features/library/library-search';
import { placeChoices, tripChoices } from '../src/features/library/place-choices';

const i18n = setupI18n({ locale: 'en', messages: { en: {} } });
i18n.activate('en');

describe('the Trip and Place filters', () => {
  it('read a trip, a country and a city from the URL, and drop what none could be', () => {
    const trip = newId<'Trip'>();
    expect(parseLibrarySearch({ trip }).trip).toBe(trip);
    expect(parseLibrarySearch({ country: 'PT' }).country).toBe('PT');
    // The router reads ?city=2267057 as a number.
    expect(parseLibrarySearch({ city: 2267057 }).city).toBe(2267057);
    expect(parseLibrarySearch({ trip: 'lisbon' }).trip).toBeUndefined();
    for (const bad of ['pt', 'PRT', 'P1', '', 7])
      expect(parseLibrarySearch({ country: bad }).country).toBeUndefined();
    for (const bad of [0, -3, 1.5, '2267057', Number.NaN])
      expect(parseLibrarySearch({ city: bad }).city).toBeUndefined();
  });

  it('are the library’s trip, country and city filters, and Clear filters lets them go', () => {
    const trip = newId<'Trip'>();
    expect(toLibraryFilters(parseLibrarySearch({ trip })).tripIds).toEqual([trip]);
    expect(toLibraryFilters(parseLibrarySearch({ country: 'PT' }))).toEqual({ countries: ['PT'] });
    expect(toLibraryFilters(parseLibrarySearch({ city: 2267057 }))).toEqual({ cityIds: [2267057] });
    const search = parseLibrarySearch({ trip, country: 'PT', q: 'beach' });
    expect(hasFilters(search)).toBe(true);
    expect(hasFilters(parseLibrarySearch({ city: 2267057 }))).toBe(true);
    expect(hasFilters({ ...search, ...NO_FILTERS })).toBe(false);
  });

  it('list each country, then its cities one level in as the dataset names them', () => {
    const places: PlaceCount[] = [
      { country: 'PT', cityId: null, city: null, region: null, clips: 5 },
      { country: 'PT', cityId: 2267057, city: 'Lisbon', region: 'Lisbon', clips: 3 },
      { country: 'PT', cityId: 2735943, city: 'Porto', region: 'Porto', clips: 2 },
      { country: 'IN', cityId: null, city: null, region: null, clips: 1 },
      { country: 'IN', cityId: 1277333, city: 'Bengaluru', region: 'Karnataka', clips: 1 },
    ];
    expect(placeChoices(i18n, places, undefined)).toEqual([
      { value: 'PT', label: 'Portugal', raw: true },
      { value: '2267057', label: 'Lisbon', raw: true, inset: true },
      { value: '2735943', label: 'Porto', raw: true, inset: true },
      { value: 'IN', label: 'India', raw: true },
      { value: '1277333', label: 'Bengaluru', raw: true, inset: true },
    ]);
    // Cities alone get their country; a chosen place no longer listed stays offered.
    const cities = placeChoices(
      i18n,
      places.filter((place) => place.cityId !== null),
      '3117735',
    );
    expect(cities.map((option) => option.value)).toEqual([
      'PT',
      '2267057',
      '2735943',
      'IN',
      '1277333',
      '3117735',
    ]);
    expect(cities.at(-1)!.label).toBe('Another place');
  });

  it('name a trip by the person’s name, as written, or its automatic one', () => {
    const base = { hint: [], startedAt: 1, endedAt: 2, clips: 3, days: 2 };
    const named: Trip = { ...base, id: newId<'Trip'>(), name: 'Beach week', place: null, month: '2026-03' };
    const automatic: Trip = {
      ...base,
      id: newId<'Trip'>(),
      name: null,
      place: { kind: 'countries', countries: ['PT'] },
      month: '2026-09',
    };
    expect(tripChoices(i18n, [named, automatic], undefined)).toEqual([
      { value: named.id, label: 'Beach week', raw: true },
      { value: automatic.id, label: 'Portugal · Sep 2026' },
    ]);
  });
});

describe('the fake library’s trips and places', () => {
  it('filters browse by a trip, a country and a city, never counting a time-zone guess', async () => {
    const { client } = createFakeBackend({ phase2: { library: { tickMs: 0 } } });
    const browse = async (filters: object) => {
      const page = await callRpc(
        client.library.browse({ filters, sort: 'captured', direction: 'desc', limit: 200 }),
      );
      if (!page.ok) throw new Error('browse failed');
      return page.value;
    };
    const trips = await callRpc(client.library.trips());
    const places = await callRpc(client.library.places());
    expect(trips.ok && places.ok).toBe(true);
    if (!trips.ok || !places.ok) return;
    const portugal = trips.value.trips.find((trip) => trip.place?.kind === 'countries')!;
    const guessed = trips.value.trips.find((trip) => trip.place === null)!;

    const inTrip = await browse({ tripIds: [portugal.id] });
    expect(inTrip.total).toBeGreaterThan(0);
    for (const clip of inTrip.items) expect(clip.trip?.id).toBe(portugal.id);

    const inCountry = await browse({ countries: ['PT'] });
    expect(inCountry.total).toBeGreaterThan(0);
    for (const clip of inCountry.items) expect(clip.place).toMatchObject({ country: 'PT' });
    for (const clip of inCountry.items) expect(clip.place?.basis).not.toBe('zone');

    const city = places.value.places.find((place) => place.country === 'PT' && place.cityId !== null)!;
    const inCity = await browse({ cityIds: [city.cityId] });
    expect(inCity.total).toBeGreaterThan(0);
    expect(inCity.total).toBeLessThanOrEqual(inCountry.total);
    for (const clip of inCity.items) expect(clip.place).toMatchObject({ cityId: city.cityId });

    // The trip known only by its time zone: its clips are in the trip, and in no country.
    const zoned = await browse({ tripIds: [guessed.id] });
    expect(zoned.total).toBeGreaterThan(0);
    for (const clip of zoned.items) expect(clip.place?.basis ?? 'zone').toBe('zone');
    const guesses = new Set(zoned.items.map((clip) => clip.id));
    const counted = await browse({ countries: [...new Set(places.value.places.map((p) => p.country))] });
    expect(counted.total).toBeGreaterThan(0);
    expect(counted.items.filter((clip) => guesses.has(clip.id))).toEqual([]);
  });
});
