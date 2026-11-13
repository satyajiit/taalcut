// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Coordinates to a city, on this Mac (LIB1-PLACE): the dataset's city nearest the coordinates within `PLACE_MAX_KM`,
 * found through a 1° grid built once per process. A city is a point, so a big one would lose its own streets to the
 * small towns at its edge (Empire State Building: Weehawken); each counts from its rough edge instead, a radius
 * growing with the root of its people (Lisbon about 4 km, a town of 10,000 about 600 m), and where the coordinates
 * are inside more than one, the bigger city wins (central Lisbon is Lisbon, not its parish). The country is the city's.
 * Past PLACE_MAX_KM (open sea, a desert) the clip has no place; its coordinates still show on the clip page.
 */
import type { Place } from '@taalcut/core';
import { degreesOf, NO_REGION, type PlacesDataset } from './dataset';

/** Farther than this from every city: no place. */
export const PLACE_MAX_KM = 150;
const EARTH_KM = 6371;
const RAD = Math.PI / 180;
const LON_CELLS = 360;
/** A city's rough radius in km per root of its people. */
const RADIUS_PER_ROOT = 0.006;

export interface NamedCity {
  readonly index: number;
  readonly cityId: number;
  readonly city: string;
  readonly region: string | null;
  readonly country: string;
  readonly latitude: number;
  readonly longitude: number;
  /** The city's IANA time zone. */
  readonly zone: string;
}

export interface Geocoder {
  readonly dataset: PlacesDataset;
  /**
   * The city the coordinates are in or nearest, within `maxKm` (default PLACE_MAX_KM) of its edge, and how far
   * outside its edge they are (0 inside), or null.
   */
  nearest(latitude: number, longitude: number, maxKm?: number): { city: NamedCity; km: number } | null;
  city(index: number): NamedCity;
  /** A 'gps' place for these coordinates, or null when no city is near enough. */
  placeAt(latitude: number, longitude: number): Extract<Place, { basis: 'gps' }> | null;
}

export function kmBetween(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = (bLat - aLat) * RAD;
  const dLon = (bLon - aLon) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * RAD) * Math.cos(bLat * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

const latCellOf = (lat: number) => Math.min(179, Math.max(0, Math.floor(lat + 90)));
const lonCellOf = (lon: number) => (((Math.floor(lon + 180) % LON_CELLS) + LON_CELLS) % LON_CELLS) as number;

export function createGeocoder(dataset: PlacesDataset): Geocoder {
  const n = dataset.lat.length;
  // Counting sort by cell: cellStart[c]..cellStart[c + 1] are the cities of cell c in `order`.
  const cellOf = new Uint32Array(n);
  const cellStart = new Uint32Array(180 * LON_CELLS + 1);
  for (let i = 0; i < n; i++) {
    const cell = latCellOf(degreesOf(dataset.lat[i]!)) * LON_CELLS + lonCellOf(degreesOf(dataset.lon[i]!));
    cellOf[i] = cell;
    cellStart[cell + 1]! += 1;
  }
  for (let c = 1; c < cellStart.length; c++) cellStart[c]! += cellStart[c - 1]!;
  const order = new Uint32Array(n);
  const fill = cellStart.slice(0, -1);
  for (let i = 0; i < n; i++) order[fill[cellOf[i]!]!++] = i;

  const { header } = dataset;
  const city = (index: number): NamedCity => {
    const region = dataset.region[index]!;
    return {
      index,
      cityId: dataset.id[index]!,
      city: dataset.nameOf(index),
      region: region === NO_REGION ? null : (header.regions[region]?.[1] ?? null),
      country: header.countries[dataset.country[index]!] ?? 'ZZ',
      latitude: degreesOf(dataset.lat[index]!),
      longitude: degreesOf(dataset.lon[index]!),
      zone: header.zones[dataset.zone[index]!] ?? 'UTC',
    };
  };

  const nearest = (latitude: number, longitude: number, maxKm = PLACE_MAX_KM) => {
    // The widest city reaches about 30 km past its centre (RADIUS_PER_ROOT × √25M).
    const spanLat = (maxKm + 30) / 111.2;
    const cos = Math.cos(latitude * RAD);
    const spanLon = cos < 0.01 ? 180 : Math.min(180, spanLat / cos);
    const lat0 = latCellOf(latitude - spanLat);
    const lat1 = latCellOf(latitude + spanLat);
    const lonCells = Math.min(
      LON_CELLS,
      Math.floor(longitude + spanLon) - Math.floor(longitude - spanLon) + 1,
    );
    const lonFirst = lonCellOf(longitude - spanLon);
    let best = -1;
    let bestKm = maxKm;
    let bestPeople = -1;
    for (let y = lat0; y <= lat1; y++)
      for (let k = 0; k < lonCells; k++) {
        const cell = y * LON_CELLS + ((lonFirst + k) % LON_CELLS);
        for (let at = cellStart[cell]!; at < cellStart[cell + 1]!; at++) {
          const i = order[at]!;
          const people = dataset.people[i]!;
          const centre = kmBetween(
            latitude,
            longitude,
            degreesOf(dataset.lat[i]!),
            degreesOf(dataset.lon[i]!),
          );
          const km = Math.max(0, centre - RADIUS_PER_ROOT * Math.sqrt(people));
          if (km < bestKm || (km === bestKm && people > bestPeople)) {
            bestKm = km;
            best = i;
            bestPeople = people;
          }
        }
      }
    return best < 0 ? null : { city: city(best), km: bestKm };
  };

  return {
    dataset,
    nearest: (latitude, longitude, maxKm) => {
      // Most clips are a few kilometres from a town: a small box first, the whole radius only when it is empty.
      const near = maxKm === undefined || maxKm > 25 ? nearest(latitude, longitude, 25) : null;
      return near ?? nearest(latitude, longitude, maxKm);
    },
    city,
    placeAt(latitude, longitude) {
      const found = this.nearest(latitude, longitude);
      if (!found) return null;
      const { city: c, km } = found;
      return {
        basis: 'gps',
        cityId: c.cityId,
        city: c.city,
        region: c.region,
        country: c.country,
        km: Math.min(1000, Math.round(km)),
      };
    },
  };
}
