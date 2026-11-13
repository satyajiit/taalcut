// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Rebuilds every clip's shown place and every trip from the assets (LIB1-PLACE), in the jobs process: what each
 * clip knows on its own (its coordinates' city, which library.place stored in `asset_places.own`, its offset, its
 * source and time) is settled into a place (infer.ts) and grouped into trips (trips.ts), then only the rows that
 * changed are written, in one transaction, and `library.changed` names their assets. A trip keeps its id and the
 * person's name while it keeps most of its clips.
 *
 * Captured clips only (not stock, generated or bundled files), sounds and Live Photos' movie halves left out, and
 * nothing in the bin.
 */
import { newId, ok, type AssetId, type EventBus, type Place, type Result, type TripId } from '@taalcut/core';
import type { LibraryDatabase } from '../db/database';
import { readPlace } from '../repositories/places';
import { attemptWrite } from '../repositories/shared';
import { settlePlaces, type GpsPlace, type PlaceSubject } from './infer';
import { assetSearchText } from './search-text';
import { groupTrips, matchTrips, type TripGroup } from './trips';
import { zoneOffsetMin } from './zones';

export interface RefreshOptions {
  readonly countriesAt: (offsetMin: number, at: number) => readonly string[];
  /** This Mac's IANA zone (default: the process's). */
  readonly homeZone?: string;
  readonly now?: () => number;
  readonly events?: Pick<EventBus, 'emit'>;
}

interface Stored {
  readonly place: string | null;
  readonly basis: string | null;
  readonly country: string | null;
  readonly cityId: number | null;
  readonly tripId: string | null;
  readonly searchText: string;
}

interface Row extends Stored {
  readonly id: AssetId;
  readonly capturedAt: number | null;
  readonly fileOffset: number | null;
  /** LIB1-OEM's borrowed zone (`asset_borrowed_offsets`), or null. */
  readonly borrowedOffset: number | null;
  readonly lat: number | null;
  readonly lon: number | null;
  readonly sourceId: string | null;
  readonly own: string | null;
  readonly hasRow: number;
}

const READ = `
SELECT a.id AS id, a.capture_time AS capturedAt,
  json_extract(a.facts, '$.captureOffsetMin') AS fileOffset, a.latitude AS lat, a.longitude AS lon,
  (SELECT b.offset_min FROM asset_borrowed_offsets b WHERE b.asset_id = a.id) AS borrowedOffset,
  (SELECT l.source_id FROM asset_locations l WHERE l.asset_id = a.id ORDER BY l.id LIMIT 1) AS sourceId,
  p.asset_id IS NOT NULL AS hasRow, p.own AS own, p.place AS place, p.basis AS basis, p.country AS country,
  p.city_id AS cityId, p.trip_id AS tripId, coalesce(p.search_text, '') AS searchText
FROM assets a LEFT JOIN asset_places p ON p.asset_id = a.id
WHERE a.trashed_at IS NULL AND a.companion_of IS NULL AND a.kind <> 'audio'
  AND coalesce(json_extract(a.provenance, '$.kind'), 'captured') = 'captured'`;

/**
 * The offset a file names: LIB1-OEM's MediaFacts.captureOffsetMin, absent when the file names no zone. 0 is UTC
 * itself (Lisbon or London in winter), a real hint like any other.
 */
function fileOffsetOf(row: Row): number | null {
  return typeof row.fileOffset === 'number' ? row.fileOffset : null;
}

const named = (p: Place | null) => (p !== null && p.basis !== 'zone' ? p : null);

export interface RefreshOutcome {
  readonly changed: number;
  readonly trips: number;
}

export function refreshPlaces(db: LibraryDatabase, options: RefreshOptions): Result<RefreshOutcome> {
  const now = options.now ?? Date.now;
  const homeZone = options.homeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const rows = db.driver.prepare(READ).all() as unknown as Row[];
  const subjects: PlaceSubject[] = rows.map((row) => {
    const own = readPlace(row.own);
    return {
      assetId: row.id,
      sourceId: row.sourceId,
      capturedAt: row.capturedAt,
      fileOffsetMin: fileOffsetOf(row),
      borrowedOffsetMin: typeof row.borrowedOffset === 'number' ? row.borrowedOffset : null,
      own: own?.basis === 'gps' ? (own as GpsPlace) : null,
      coords:
        typeof row.lat === 'number' && typeof row.lon === 'number' ? { lat: row.lat, lon: row.lon } : null,
    };
  });
  const settled = settlePlaces(subjects, { countriesAt: options.countriesAt });
  const groups = groupTrips(
    settled.flatMap((s, i) =>
      rows[i]!.capturedAt === null
        ? []
        : [
            {
              assetId: s.assetId,
              capturedAt: rows[i]!.capturedAt!,
              place: s.place,
              offsetMin: s.offset?.minutes ?? null,
              coords: s.coords,
            },
          ],
    ),
    { homeOffsetAt: (at) => zoneOffsetMin(homeZone, at) },
  );

  const known = new Map<TripId, Set<AssetId>>();
  for (const row of rows)
    if (row.tripId)
      known.set(row.tripId as TripId, (known.get(row.tripId as TripId) ?? new Set()).add(row.id));
  const names = new Map<TripId, string | null>(
    db.driver
      .prepare('SELECT id, name FROM trips')
      .all()
      .map((r) => [r.id as TripId, (r.name as string | null) ?? null]),
  );
  const matched = matchTrips(
    groups,
    [...names.keys()].map((id) => ({ id, members: known.get(id) ?? new Set<AssetId>() })),
    () => newId<'Trip'>(),
  );
  const tripOf = new Map<AssetId, { id: TripId; group: TripGroup }>();
  for (const m of matched) for (const id of m.group.members) tripOf.set(id, m);

  const updates = settled.flatMap((s, i) => {
    const row = rows[i]!;
    const trip = tripOf.get(s.assetId);
    const tripView = trip
      ? { name: names.get(trip.id) ?? null, place: trip.group.place, hint: [...trip.group.hint] }
      : null;
    const next: Stored = {
      place: s.place ? JSON.stringify(s.place) : null,
      basis: s.place?.basis ?? null,
      country: named(s.place)?.country ?? null,
      cityId: named(s.place)?.cityId ?? null,
      tripId: trip?.id ?? null,
      searchText: assetSearchText(s.place, tripView),
    };
    const same =
      row.hasRow &&
      row.place === next.place &&
      row.basis === next.basis &&
      row.country === next.country &&
      row.cityId === next.cityId &&
      row.tripId === next.tripId &&
      row.searchText === next.searchText;
    // A clip with nothing to say and no row yet needs none.
    if (same || (!row.hasRow && next.place === null && next.tripId === null)) return [];
    return [{ id: s.assetId, next }];
  });
  const gone = [...names.keys()].filter((id) => !matched.some((m) => m.id === id));

  const written = attemptWrite(db, 'trip', () =>
    db.transaction(() => {
      const at = now();
      const upsertTrip = db.driver.prepare(
        `INSERT INTO trips (id, name, place, hint, month, started_at, ended_at, clips, days, search_text,
           created_at, updated_at)
         VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET place = excluded.place, hint = excluded.hint, month = excluded.month,
           started_at = excluded.started_at, ended_at = excluded.ended_at, clips = excluded.clips,
           days = excluded.days, search_text = excluded.search_text, updated_at = excluded.updated_at
         WHERE place IS NOT excluded.place OR hint IS NOT excluded.hint OR month IS NOT excluded.month
           OR started_at IS NOT excluded.started_at OR ended_at IS NOT excluded.ended_at
           OR clips IS NOT excluded.clips OR days IS NOT excluded.days OR search_text IS NOT excluded.search_text`,
      );
      for (const { id, group } of matched) {
        const words = assetSearchText(null, {
          name: names.get(id) ?? null,
          place: group.place,
          hint: [...group.hint],
        });
        upsertTrip.run(
          id,
          group.place ? JSON.stringify(group.place) : null,
          JSON.stringify(group.hint),
          group.month,
          group.startedAt,
          group.endedAt,
          group.members.length,
          group.days,
          words,
          at,
          at,
        );
      }
      const upsertPlace = db.driver.prepare(
        `INSERT INTO asset_places (asset_id, own, place, basis, country, city_id, trip_id, search_text, updated_at)
         VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (asset_id) DO UPDATE SET place = excluded.place, basis = excluded.basis,
           country = excluded.country, city_id = excluded.city_id, trip_id = excluded.trip_id,
           search_text = excluded.search_text, updated_at = excluded.updated_at`,
      );
      for (const { id, next } of updates)
        upsertPlace.run(
          id,
          next.place,
          next.basis,
          next.country,
          next.cityId,
          next.tripId,
          next.searchText,
          at,
        );
      const drop = db.driver.prepare('DELETE FROM trips WHERE id = ?');
      for (const id of gone) drop.run(id);
    }),
  );
  if (!written.ok) return written;
  const ids = updates.map((u) => u.id);
  for (let i = 0; i < ids.length; i += 1000)
    options.events?.emit('library.changed', {
      projectId: null,
      entity: 'asset',
      change: 'updated',
      ids: ids.slice(i, i + 1000),
    });
  return ok({ changed: ids.length, trips: matched.length });
}
