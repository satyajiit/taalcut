// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LIB1-PLACE: the shipped dataset loads, names the city coordinates are in (a big city keeps its own streets, a
 * village keeps its own beach), stops at open sea, and wraps at the antimeridian; a UTC offset names the countries
 * that kept it at that moment, summer time included. The dataset's file round-trips through its own encoder.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  createGeocoder,
  createZoneHints,
  decodePlaces,
  encodePlaces,
  loadPlaces,
  PLACES_DATASET_FILE,
  zoneOffsetMin,
  type Geocoder,
  type ZoneHints,
} from '../../src/index';

const DATASET = fileURLToPath(new URL(`../../data/${PLACES_DATASET_FILE}`, import.meta.url));

let geocoder: Geocoder;
let zones: ZoneHints;

beforeAll(() => {
  const dataset = loadPlaces(DATASET);
  geocoder = createGeocoder(dataset);
  zones = createZoneHints(dataset);
});

describe('the places dataset', () => {
  it('is small enough to ship and says where it came from', () => {
    const lock = JSON.parse(
      readFileSync(fileURLToPath(new URL('../../data/places.lock.json', import.meta.url)), 'utf8'),
    ) as { bytes: number; licence: string; cities: number };
    expect(readFileSync(DATASET).length).toBe(lock.bytes);
    expect(lock.bytes).toBeLessThan(5_000_000);
    expect(lock.licence).toBe('CC-BY-4.0');
    expect(lock.cities).toBeGreaterThan(100_000);
  });

  it('round-trips through its encoder, names in any script and a city with no region', () => {
    const file = encodePlaces(
      {
        source: '2026-10-28',
        countries: ['GR', 'PT'],
        regions: [[1, 'Lisboa']],
        zones: ['Europe/Lisbon'],
        zonePeople: [[0, 1, 10_000_000]],
      },
      [
        {
          id: 1,
          name: 'Lisbon',
          latitude: 38.71667,
          longitude: -9.13333,
          people: 517_802,
          country: 1,
          region: 0,
          zone: 0,
        },
        {
          id: 2,
          name: 'Αθήνα',
          latitude: 37.98,
          longitude: 23.73,
          people: 0,
          country: 0,
          region: 0xffff,
          zone: 0,
        },
      ],
    );
    const dataset = decodePlaces(file);
    expect(dataset.header.cities).toBe(2);
    expect(dataset.nameOf(0)).toBe('Lisbon');
    expect(dataset.nameOf(1)).toBe('Αθήνα');
    const small = createGeocoder(dataset);
    expect(small.placeAt(38.72, -9.14)).toMatchObject({ city: 'Lisbon', region: 'Lisboa', country: 'PT' });
    expect(small.placeAt(37.98, 23.73)).toMatchObject({ cityId: 2, region: null, country: 'GR' });
    expect(() =>
      decodePlaces(encodePlaces({ source: '', countries: [], regions: [], zones: [], zonePeople: [] }, [])),
    ).not.toThrow();
    expect(() => decodePlaces(new Uint8Array([1, 2, 3]))).toThrow();
  });
});

describe('the geocoder', () => {
  it.each([
    ['central Lisbon, not its parish', 38.7223, -9.1393, { city: 'Lisbon', region: 'Lisbon', country: 'PT' }],
    ['Manhattan, not Weehawken', 40.7484, -73.9857, { city: 'New York City', country: 'US' }],
    ['a beach village in Goa', 15.6311, 73.7372, { city: 'Morjim', region: 'Goa', country: 'IN' }],
    ['a town in the hills', 38.7979, -9.3906, { city: 'Sintra', region: 'Lisbon', country: 'PT' }],
    ['Fiji, across the antimeridian', -16.5, 179.99, { country: 'FJ' }],
  ])('names %s', (_, latitude, longitude, expected) => {
    const place = geocoder.placeAt(latitude, longitude);
    expect(place).toMatchObject({ basis: 'gps', ...expected });
    expect(place!.cityId).toBeGreaterThan(0);
  });

  it('names nothing far out at sea', () => {
    expect(geocoder.placeAt(0, -150)).toBeNull();
    expect(geocoder.nearest(0, -150)).toBeNull();
  });

  it('says how far past a city a point is', () => {
    const place = geocoder.placeAt(38.85, -9.47);
    expect(place).toMatchObject({ city: 'Fontanelas', country: 'PT' });
    expect(place!.km).toBeGreaterThan(0);
    expect(place!.km).toBeLessThan(30);
  });
});

describe('time-zone hints', () => {
  const march = Date.UTC(2026, 2, 14, 3, 0);

  it('names the countries that keep an offset, the likeliest first', () => {
    expect(zones.countriesAt(-180, march)).toEqual(['BR', 'AR', 'CL']);
    expect(zones.countriesAt(330, march)[0]).toBe('IN');
    expect(zones.countriesAt(345, march)).toEqual(['NP']);
    expect(zones.countriesAt(-17, march)).toEqual([]);
  });

  it('follows summer time', () => {
    expect(zones.countriesAt(-240, Date.UTC(2026, 6, 1))[0]).toBe('US');
    expect(zones.countriesAt(-240, Date.UTC(2026, 0, 10))).not.toContain('US');
    expect(zoneOffsetMin('Europe/London', Date.UTC(2026, 6, 1))).toBe(60);
    expect(zoneOffsetMin('Europe/London', Date.UTC(2026, 0, 1))).toBe(0);
    expect(zoneOffsetMin('Asia/Kolkata', march)).toBe(330);
    expect(zoneOffsetMin('Not/AZone', march)).toBeNull();
  });
});
