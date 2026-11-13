// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** LIB1-PLACE: a clip's place and trip as the library names them, and the trip rename. */
import { describe, expect, it } from 'vitest';
import {
  assetSummarySchema,
  newId,
  PLACE_COMMANDS,
  PLACE_STAGE,
  placeCommandPayloads,
  placeCountSchema,
  placeInWords,
  placeQueries,
  placeSchema,
  storedPlace,
  tripSchema,
  type Place,
} from '@taalcut/core';

const lisbon: Place = {
  basis: 'gps',
  cityId: 2267057,
  city: 'Lisbon',
  region: 'Lisbon',
  country: 'PT',
  km: 2,
};

const trip = {
  id: newId<'Trip'>(),
  name: null,
  place: { kind: 'city', name: 'Lisbon', country: 'PT' },
  hint: [],
  month: '2026-03',
  startedAt: 1_773_457_200_000,
  endedAt: 1_773_469_800_000,
  clips: 2,
  days: 1,
} as const;

const summary = {
  id: newId<'Asset'>(),
  kind: 'video',
  name: 'clip-0001.mp4',
  capturedAt: 1_773_457_200_000,
  addedAt: 1_773_565_200_000,
  duration: { value: 158, rate: { num: 30, den: 1 } },
  width: 1080,
  height: 1920,
  orientation: 'portrait',
  availability: 'online',
  sourceIds: [newId<'Source'>()],
  description: null,
  quality: null,
  shotCount: 1,
  language: null,
  index: { state: 'done', done: 15, total: 15, searchableAt: null },
  thumbnail: null,
  reencode: null,
  trashed: false,
  provenance: { kind: 'captured' },
} as const;

describe('places', () => {
  it('reads each basis, UTC+0 among the offsets, and refuses a lowercase country', () => {
    expect(placeSchema.parse(lisbon)).toEqual(lisbon);
    const nearby = { ...lisbon, basis: 'nearby', from: newId<'Asset'>(), apartMs: 600_000 };
    expect(placeSchema.safeParse(nearby).success).toBe(true);
    const zone = { basis: 'zone', offsetMin: -180, offsetFrom: 'file', countries: ['BR', 'AR', 'CL'] };
    expect(placeSchema.safeParse(zone).success).toBe(true);
    expect(placeSchema.safeParse({ ...zone, offsetMin: 0, countries: ['GB', 'PT'] }).success).toBe(true);
    expect(placeSchema.safeParse({ ...zone, countries: [] }).success).toBe(false);
    expect(placeSchema.safeParse({ ...zone, countries: ['BR', 'AR', 'CL', 'UY'] }).success).toBe(false);
    expect(placeSchema.safeParse({ ...lisbon, country: 'pt' }).success).toBe(false);
  });

  it('puts a place and a trip on a summary, optional for summaries made before', () => {
    expect(assetSummarySchema.safeParse(summary).success).toBe(true);
    const placed = assetSummarySchema.parse({ ...summary, place: lisbon, trip });
    expect(placed.place).toEqual(lisbon);
    expect(placed.trip?.month).toBe('2026-03');
    expect(assetSummarySchema.safeParse({ ...summary, place: null, trip: null }).success).toBe(true);
    expect(tripSchema.safeParse({ ...trip, month: '2026-13' }).success).toBe(false);
    expect(tripSchema.safeParse({ ...trip, name: 'Portugal trip' }).success).toBe(true);
  });

  it('reads the stage output from a view, and nothing from a stage that never ran', () => {
    expect(storedPlace({ outputs: { [PLACE_STAGE]: { place: lisbon } } })).toEqual(lisbon);
    expect(storedPlace({ outputs: { [PLACE_STAGE]: { place: null } } })).toBeNull();
    expect(storedPlace({ outputs: {} })).toBeNull();
    expect(storedPlace({ outputs: { [PLACE_STAGE]: { place: { basis: 'gps' } } } })).toBeNull();
  });

  it('words a place for a model, a hint always as probable', () => {
    expect(placeInWords(lisbon)).toBe('Lisbon, Portugal');
    expect(placeInWords({ ...lisbon, city: 'Sintra', region: 'Lisbon', km: 22 })).toBe(
      'near Sintra, Lisbon, Portugal',
    );
    expect(
      placeInWords({ basis: 'zone', offsetMin: -180, offsetFrom: 'nearby', countries: ['BR', 'AR'] }),
    ).toBe('probably Brazil or Argentina (from its time zone)');
    expect(
      placeInWords({ basis: 'zone', offsetMin: -180, offsetFrom: 'file', countries: ['BR', 'AR', 'CL'] }),
    ).toBe('probably Brazil, Argentina or Chile (from its time zone)');
    expect(placeInWords({ basis: 'zone', offsetMin: 330, offsetFrom: 'file', countries: ['IN'] })).toBe(
      'probably India (from its time zone)',
    );
    expect(placeInWords(lisbon, 'not a locale!')).toContain('Lisbon');
  });

  it('renames a trip, or gives it back its automatic name', () => {
    const payload = placeCommandPayloads[PLACE_COMMANDS.renameTrip];
    expect(payload.parse({ tripId: trip.id, name: '  Portugal trip ' }).name).toBe('Portugal trip');
    expect(payload.parse({ tripId: trip.id, name: null }).name).toBeNull();
    expect(payload.safeParse({ tripId: trip.id, name: '   ' }).success).toBe(false);
    expect(payload.safeParse({ tripId: 'nope', name: 'x' }).success).toBe(false);
  });

  it('lists places and trips for filters', () => {
    expect(
      placeCountSchema.safeParse({ country: 'PT', cityId: null, city: null, region: null, clips: 2 }).success,
    ).toBe(true);
    expect(Object.keys(placeQueries).sort()).toEqual(['places', 'trips']);
  });
});
