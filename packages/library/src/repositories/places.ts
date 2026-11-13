// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Reading places and trips (LIB1-PLACE, migration 34): each asset's place and trip for its summary (one query for a
 * page), every trip for `library.trips`, and the countries and cities with clips for `library.places`. Rows that
 * don't parse through core's schemas read as no place (a newer app's row in an older one).
 */
import {
  placeSchema,
  tripPlaceSchema,
  tripSchema,
  type AssetId,
  type Place,
  type PlaceCount,
  type Trip,
} from '@taalcut/core';
import type { LibraryDatabase } from '../db/database';
import type { TripRow } from '../places/places-table';
import { USER_IMPORTED_ASSET_SQL } from '../profile/filters';

const IN_JSON = 'IN (SELECT value FROM json_each(?))';

const json = (text: unknown): unknown => {
  if (typeof text !== 'string') return text ?? null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

export function readPlace(value: unknown): Place | null {
  const parsed = placeSchema.safeParse(json(value));
  return parsed.success ? parsed.data : null;
}

type TripColumns = Pick<TripRow, 'id' | 'name' | 'month' | 'startedAt' | 'endedAt' | 'clips' | 'days'> & {
  readonly place: unknown;
  readonly hint: unknown;
};

export function readTrip(row: TripColumns): Trip | null {
  const place = row.place == null ? null : tripPlaceSchema.safeParse(json(row.place));
  const parsed = tripSchema.safeParse({
    id: row.id,
    name: row.name,
    place: place === null ? null : place.success ? place.data : null,
    hint: json(row.hint) ?? [],
    month: row.month,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    clips: row.clips,
    days: row.days,
  });
  return parsed.success ? parsed.data : null;
}

const TRIP_SQL = `t.id AS id, t.name AS name, t.place AS place, t.hint AS hint, t.month AS month,
  t.started_at AS startedAt, t.ended_at AS endedAt, t.clips AS clips, t.days AS days`;

/** Each asset's place and trip, for its summary; an asset without a row has neither. */
export function placesOf(
  db: LibraryDatabase,
  assetIds: readonly AssetId[],
): Map<AssetId, { place: Place | null; trip: Trip | null }> {
  if (assetIds.length === 0) return new Map();
  const rows = db.driver
    .prepare(
      `SELECT p.asset_id AS assetId, p.place AS placeJson, ${TRIP_SQL}
       FROM asset_places p LEFT JOIN trips t ON t.id = p.trip_id WHERE p.asset_id ${IN_JSON}`,
    )
    .all(JSON.stringify(assetIds));
  return new Map(
    rows.map((row) => [
      row.assetId as AssetId,
      {
        place: readPlace(row.placeJson),
        trip: row.id == null ? null : readTrip(row as unknown as TripColumns),
      },
    ]),
  );
}

/** Every trip, newest first. */
export function listTrips(db: LibraryDatabase, limit = 1000): Trip[] {
  return db.driver
    .prepare(`SELECT ${TRIP_SQL} FROM trips t ORDER BY t.started_at DESC, t.id LIMIT ?`)
    .all(limit)
    .flatMap((row) => {
      const trip = readTrip(row as unknown as TripColumns);
      return trip ? [trip] : [];
    });
}

/**
 * The countries and cities the library's clips are in (by coordinates, theirs or a neighbour's; hints aren't
 * places), most clips first: each country, then its cities.
 */
export function listPlaces(db: LibraryDatabase, limit = 2000): PlaceCount[] {
  const rows = db.driver
    .prepare(
      `SELECT p.country AS country, p.city_id AS cityId, count(*) AS clips,
         json_extract(min(p.place), '$.city') AS city, json_extract(min(p.place), '$.region') AS region
       FROM asset_places p JOIN assets a ON a.id = p.asset_id
       WHERE p.country IS NOT NULL AND p.basis IN ('gps', 'nearby') AND a.trashed_at IS NULL
         AND ${USER_IMPORTED_ASSET_SQL}
       GROUP BY p.country, p.city_id`,
    )
    .all() as {
    country: string;
    cityId: number;
    clips: number;
    city: string | null;
    region: string | null;
  }[];
  const countries = new Map<string, number>();
  for (const row of rows) countries.set(row.country, (countries.get(row.country) ?? 0) + row.clips);
  const out: PlaceCount[] = [];
  for (const [country, clips] of [...countries].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    out.push({ country, cityId: null, city: null, region: null, clips });
    for (const row of rows
      .filter((r) => r.country === country && r.city)
      .sort((a, b) => b.clips - a.clips || a.cityId - b.cityId))
      out.push({ country, cityId: row.cityId, city: row.city, region: row.region, clips: row.clips });
  }
  return out.slice(0, limit);
}

/** The assets in a trip. */
export function tripMembers(db: LibraryDatabase, tripId: string): AssetId[] {
  return db.driver
    .prepare('SELECT asset_id AS id FROM asset_places WHERE trip_id = ? ORDER BY asset_id')
    .all(tripId)
    .map((row) => row.id as AssetId);
}
