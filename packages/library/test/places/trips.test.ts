// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LIB1-PLACE: what a clip borrows from its neighbours (a city within 3 hours, an offset within 12, from its own
 * source only), and how clips become trips: away from home by distance or time zone, split by gaps of more than two
 * days and by a clip at home, named by place, kept by id while they keep most of their clips. Two clips with no
 * GPS (one file at −03:00, one borrowing its zone) make one trip seen from an Indian Mac.
 */
import type { AssetId, Place } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import {
  groupTrips,
  matchTrips,
  settlePlaces,
  zoneOffsetMin,
  type PlaceSubject,
  type TripSubject,
} from '../../src/index';

const H = 3_600_000;
const DAY = 24 * H;
const id = (n: number) => `01JAAAAAAAAAAAAAAAAAAAAA${String(n).padStart(2, '0')}` as AssetId;
const india = { homeOffsetAt: (at: number) => zoneOffsetMin('Asia/Kolkata', at) };
const HINTS: Readonly<Record<number, string[]>> = {
  [-180]: ['BR', 'AR', 'CL'],
  0: ['GB', 'CI', 'MA'],
  330: ['IN'],
};
const countriesAt = (offset: number) => HINTS[offset] ?? [];

const city = (cityId: number, name: string, country: string, region: string | null = null) =>
  ({ basis: 'gps', cityId, city: name, region, country, km: 0 }) as const;
const LISBON = city(2267057, 'Lisbon', 'PT', 'Lisbon');
const SINTRA = city(2262912, 'Sintra', 'PT', 'Lisbon');
const MADRID = city(3117735, 'Madrid', 'ES', 'Madrid');
const MUMBAI = city(1275339, 'Mumbai', 'IN', 'Maharashtra');
const MORJIM = city(1262768, 'Morjim', 'IN', 'Goa');
const PANAJI = city(1260607, 'Panaji', 'IN', 'Goa');
const coords = {
  lisbon: { lat: 38.72, lon: -9.14 },
  sintra: { lat: 38.8, lon: -9.39 },
  madrid: { lat: 40.42, lon: -3.7 },
  mumbai: { lat: 19.07, lon: 72.88 },
  goa: { lat: 15.6, lon: 73.74 },
};

/** A synthetic moment, Mar 14, 2026, 03:00 UTC: winter in Lisbon. */
const T0 = Date.UTC(2026, 2, 14, 3, 0);

function subject(n: number, at: number, extra: Partial<PlaceSubject> = {}): PlaceSubject {
  return {
    assetId: id(n),
    sourceId: 'phone',
    capturedAt: at,
    fileOffsetMin: null,
    own: null,
    coords: null,
    ...extra,
  };
}

function trip(
  n: number,
  at: number,
  place: Place | null,
  offsetMin: number | null,
  at2?: { lat: number; lon: number },
): TripSubject {
  return { assetId: id(n), capturedAt: at, place, offsetMin, coords: at2 ?? null };
}

describe('settling places', () => {
  it("borrows a neighbour's city within three hours, from the same source only", () => {
    const settled = settlePlaces(
      [
        subject(1, T0, { own: LISBON, coords: coords.lisbon }),
        subject(2, T0 + 2 * H),
        subject(3, T0 + 4 * H),
        subject(4, T0 + H, { sourceId: 'friend' }),
      ],
      { countriesAt },
    );
    expect(settled[0]!.place).toEqual(LISBON);
    expect(settled[1]!.place).toEqual({ ...LISBON, basis: 'nearby', from: id(1), apartMs: 2 * H });
    expect(settled[1]!.coords).toEqual(coords.lisbon);
    expect(settled[2]!.place).toBeNull();
    expect(settled[3]!.place).toBeNull();
  });

  it("takes a neighbour's offset within twelve hours as a hint, and UTC+0 as a real offset", () => {
    const [named, borrowed, later, utc] = settlePlaces(
      [
        subject(1, T0, { fileOffsetMin: -180 }),
        subject(2, T0 + 3 * H),
        subject(3, T0 + 13 * H),
        subject(4, T0, { sourceId: 'other', fileOffsetMin: 0 }),
      ],
      { countriesAt },
    );
    expect(named!.place).toEqual({
      basis: 'zone',
      offsetMin: -180,
      offsetFrom: 'file',
      countries: ['BR', 'AR', 'CL'],
    });
    expect(borrowed!.offset).toEqual({ minutes: -180, from: 'nearby' });
    expect(borrowed!.place).toMatchObject({ basis: 'zone', offsetFrom: 'nearby' });
    expect(later!.place).toBeNull();
    expect(utc!.offset).toEqual({ minutes: 0, from: 'file' });
    expect(utc!.place).toEqual({
      basis: 'zone',
      offsetMin: 0,
      offsetFrom: 'file',
      countries: ['GB', 'CI', 'MA'],
    });
  });

  it('keeps a clip without a time to its own coordinates', () => {
    const [own, none] = settlePlaces(
      [
        subject(1, 0, { capturedAt: null, own: LISBON, coords: coords.lisbon }),
        subject(2, 0, { capturedAt: null }),
      ],
      { countriesAt },
    );
    expect(own!.place).toEqual(LISBON);
    expect(none!.place).toBeNull();
  });
});

describe('trips', () => {
  const zone: Place = { basis: 'zone', offsetMin: -180, offsetFrom: 'file', countries: ['BR', 'AR', 'CL'] };

  it('puts two clips known only by UTC−3 in one trip, hinted, on that calendar', () => {
    const groups = groupTrips(
      [
        trip(1, T0, zone, -180),
        trip(2, T0 + 3 * H - 1, { ...zone, offsetFrom: 'nearby' }, -180),
        trip(3, T0 - 30 * DAY, null, 330),
      ],
      india,
    );
    expect(groups).toEqual([
      {
        members: [id(1), id(2)],
        place: null,
        hint: ['BR', 'AR', 'CL'],
        month: '2026-03',
        startedAt: T0,
        endedAt: T0 + 3 * H - 1,
        days: 1,
      },
    ]);
  });

  it('splits at a gap of more than two days and at a clip shot at home, and needs two clips away', () => {
    const groups = groupTrips(
      [
        trip(1, T0, zone, -180),
        trip(2, T0 + DAY, zone, -180),
        trip(3, T0 + DAY + 2 * DAY + H, zone, -180),
        trip(4, T0 + 4 * DAY, zone, -180),
        trip(5, T0 + 4 * DAY + H, null, 330),
        trip(6, T0 + 4 * DAY + 2 * H, zone, -180),
      ],
      india,
    );
    expect(groups.map((g) => g.members)).toEqual([
      [id(1), id(2)],
      [id(3), id(4)],
    ]);
  });

  it('takes in a clip that knows nothing between two of its clips', () => {
    const groups = groupTrips(
      [
        trip(1, T0, zone, -180),
        trip(2, T0 + H, null, null),
        trip(3, T0 + 2 * H, zone, -180),
        trip(4, T0 + 3 * H, null, null),
      ],
      india,
    );
    expect(groups[0]!.members).toEqual([id(1), id(2), id(3)]);
  });

  it('names a trip abroad by its countries, most clips first', () => {
    const groups = groupTrips(
      [
        trip(1, T0, LISBON, 0, coords.lisbon),
        trip(2, T0 + DAY, SINTRA, 0, coords.sintra),
        trip(3, T0 + 2 * DAY, SINTRA, 0, coords.sintra),
        trip(4, T0 + 3 * DAY, MADRID, 60, coords.madrid),
      ],
      india,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      place: { kind: 'countries', countries: ['PT', 'ES'] },
      days: 4,
      hint: [],
    });
  });

  it('finds home in the city with the most days, and names a trip at home by its city or region', () => {
    const home = [0, 5, 9, 14].map((d, i) => trip(10 + i, T0 - (60 - d) * DAY, MUMBAI, 330, coords.mumbai));
    const goa = [
      trip(1, T0, MORJIM, 330, coords.goa),
      trip(2, T0 + H, MORJIM, 330, coords.goa),
      trip(3, T0 + DAY, PANAJI, 330, { lat: 15.49, lon: 73.83 }),
      trip(4, T0 + DAY + H, PANAJI, 330, { lat: 15.49, lon: 73.83 }),
    ];
    const [byRegion] = groupTrips([...home, ...goa], india);
    expect(byRegion).toMatchObject({
      members: [id(1), id(2), id(3), id(4)],
      place: { kind: 'region', name: 'Goa', country: 'IN' },
    });
    const [byCity] = groupTrips([...home, ...goa.slice(0, 2)], india);
    expect(byCity!.place).toEqual({ kind: 'city', name: 'Morjim', country: 'IN' });
    // Without a home city a clip shot at the home offset is home: no trip.
    expect(groupTrips(goa, india)).toEqual([]);
  });

  it('keeps a trip id while it keeps most of its clips, and gives a new one otherwise', () => {
    const [a, b] = groupTrips(
      [
        trip(1, T0, zone, -180),
        trip(2, T0 + H, zone, -180),
        trip(3, T0 + 10 * DAY, zone, -180),
        trip(4, T0 + 10 * DAY + H, zone, -180),
      ],
      india,
    );
    const known = [
      { id: 'old-1', members: new Set([id(1), id(2), id(9)]) },
      { id: 'old-2', members: new Set([id(2)]) },
    ];
    let n = 0;
    const matched = matchTrips([a!, b!], known, () => `new-${++n}`);
    expect(matched.map((m) => [m.id, m.kept])).toEqual([
      ['old-1', true],
      ['new-1', false],
    ]);
  });
});
