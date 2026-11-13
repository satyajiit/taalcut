// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// LIB1-PLACE: the grid by day counts a clip on the calendar of the place it was shot when its file names the zone,
// a day that comes round again keeps a key of its own, and the first day of a trip in the grid's order carries the
// trip's band (once). The words: countries in the UI's language, a trip's automatic name, its month and a UTC
// offset.
import { setupI18n } from '@lingui/core';
import type { Trip, TripId } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { clipDay, DAY_HEADING, layoutDays, placeOf, TRIP_BAND } from '../src/features/library/day-layout';
import {
  countryList,
  countryName,
  offsetWords,
  tripMonth,
  tripName,
} from '../src/features/library/trips/trip-words';

const metrics = { columns: 4, row: 100, gap: 12 };
const i18n = setupI18n({ locale: 'en', messages: { en: {} } });

const trip: Trip = {
  id: '01JBTRIP000000000000000000' as TripId,
  name: null,
  place: { kind: 'countries', countries: ['PT'] },
  hint: [],
  month: '2026-03',
  startedAt: Date.UTC(2026, 2, 13, 11),
  endedAt: Date.UTC(2026, 2, 14, 13),
  clips: 3,
  days: 2,
};

describe('library › days on the calendar where they were shot', () => {
  it('counts a clip with its zone on that day, and one without on this computer’s', () => {
    // 21:30 in São Paulo (UTC−3) is 00:30 UTC the next day: Mar 14 there, whatever this computer's zone.
    const evening = {
      capturedAt: Date.UTC(2026, 2, 15, 0, 30),
      addedAt: 0,
      captureOffset: { minutes: -180 },
    };
    expect(clipDay(evening, 'captured').key).toBe('2026-03-14');
    expect(new Date(clipDay(evening, 'captured').start).getDate()).toBe(14);
    // UTC+0 (Lisbon in winter) is a zone like any other: 23:30 there is Mar 14.
    const lisbon = { capturedAt: Date.UTC(2026, 2, 14, 23, 30), addedAt: 0, captureOffset: { minutes: 0 } };
    expect(clipDay(lisbon, 'captured').key).toBe('2026-03-14');
    // Sorted by when it was added, the zone of the capture doesn't count.
    const added = { ...evening, addedAt: new Date(2026, 2, 1, 12).getTime() };
    expect(clipDay(added, 'added').key).toBe('2026-03-01');
    const plain = { capturedAt: new Date(2026, 2, 5, 9).getTime(), addedAt: 0 };
    expect(clipDay(plain, 'captured').key).toBe('2026-03-05');
  });

  it('keeps a day that comes round again apart, with a key of its own', () => {
    const a = { capturedAt: Date.UTC(2026, 2, 14, 10), addedAt: 0, captureOffset: { minutes: 60 } };
    const b = { capturedAt: Date.UTC(2026, 2, 14, 9), addedAt: 0, captureOffset: { minutes: -600 } };
    const c = { capturedAt: Date.UTC(2026, 2, 14, 8), addedAt: 0, captureOffset: { minutes: 60 } };
    const layout = layoutDays([a, b, c], 3, metrics, 'captured');
    expect(layout.groups.map((g) => g.key)).toEqual(['2026-03-14', '2026-03-13', '2026-03-14~2']);
  });
});

describe('library › a trip’s band', () => {
  it('sits above the first day of a trip in the grid’s order, once, and moves its rows down', () => {
    const day = (d: number, h: number, inTrip: boolean) => ({
      capturedAt: Date.UTC(2026, 2, d, h),
      addedAt: 0,
      captureOffset: { minutes: 0 },
      trip: inTrip ? trip : null,
    });
    const items = [
      day(25, 5, false),
      day(22, 5, true),
      day(22, 4, true),
      day(21, 5, true),
      day(15, 5, false),
    ];
    const layout = layoutDays(items, items.length, metrics, 'captured');
    expect(layout.groups.map((g) => [g.key, g.trip?.id ?? null, g.heading])).toEqual([
      ['2026-03-25', null, DAY_HEADING],
      ['2026-03-22', trip.id, DAY_HEADING + TRIP_BAND],
      ['2026-03-21', null, DAY_HEADING],
      ['2026-03-15', null, DAY_HEADING],
    ]);
    const second = layout.groups[1]!;
    expect(second.top).toBe(DAY_HEADING + 100);
    expect(placeOf(layout, 1)).toEqual({ column: 0, top: second.top + DAY_HEADING + TRIP_BAND });
    // Sorted by when they were added there are no trips.
    expect(layoutDays(items, items.length, metrics, 'added').groups.every((g) => g.trip === null)).toBe(true);
  });
});

describe('library › place and trip words', () => {
  it('names countries in the UI’s language, and lists a time zone’s as a choice', () => {
    expect(countryName(i18n, 'PT')).toBe('Portugal');
    expect(countryName(setupI18n({ locale: 'hi', messages: { hi: {} } }), 'PT')).toBe('पुर्तगाल');
    expect(countryList(i18n, ['BR', 'AR', 'CL'], true)).toBe('Brazil, Argentina, or Chile');
    expect(countryList(i18n, ['PT', 'ES'])).toBe('Portugal and Spain');
  });

  it('names a trip by its place and month, or the person’s name for it', () => {
    expect(tripMonth(i18n, '2026-03')).toBe('Mar 2026');
    expect(tripName(i18n, trip)).toBe('Portugal · Mar 2026');
    expect(tripName(i18n, { ...trip, place: { kind: 'city', name: 'Goa', country: 'IN' } })).toBe(
      'Goa · Mar 2026',
    );
    expect(tripName(i18n, { ...trip, place: null })).toBe('Trip · Mar 2026');
    expect(tripName(i18n, { ...trip, name: 'Honeymoon' })).toBe('Honeymoon');
  });

  it('writes an offset as people do', () => {
    expect([offsetWords(60), offsetWords(330), offsetWords(-180), offsetWords(0)]).toEqual([
      'UTC+1',
      'UTC+5:30',
      'UTC−3',
      'UTC+0',
    ]);
  });
});
