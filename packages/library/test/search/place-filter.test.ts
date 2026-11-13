// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LIB1-FIND: the trip, country and city filters over place's `asset_places`. Countries and cities count only a
 * place from coordinates (gps, nearby); a time-zone hint never does. The tables are place's migration's
 * (0034-places-and-trips.ts), written to directly as the library.place stage would.
 */
import { newId, unwrap, type AssetId, type LibraryFilters } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { filterSql } from '../../src/index';
import { openTestDb } from '../helpers';
import { profileSetup, range24 } from '../repositories/profile-helpers';

function library() {
  const db = openTestDb();
  const setup = profileSetup(db);
  const trip = newId<'Trip'>();
  db.driver
    .prepare(
      `INSERT INTO trips (id, month, started_at, ended_at, clips, days, created_at, updated_at)
       VALUES (?, '2026-03', 1, 2, 2, 1, 1, 1)`,
    )
    .run(trip);
  const place = (
    asset: AssetId,
    basis: string,
    country: string | null,
    city: number | null,
    tripId: string | null,
  ) =>
    db.driver
      .prepare(
        'INSERT INTO asset_places (asset_id, basis, country, city_id, trip_id, updated_at) VALUES (?, ?, ?, ?, ?, 1)',
      )
      .run(asset, basis, country, city, tripId);
  const lisbon = setup.asset();
  const sintra = setup.asset();
  const guessed = setup.asset();
  const nowhere = setup.asset();
  place(lisbon, 'gps', 'PT', 2267057, trip);
  place(sintra, 'nearby', 'PT', 2262963, trip);
  // A time-zone hint: place stores no country or city for it, and its basis says it's a guess.
  place(guessed, 'zone', null, null, null);
  const clips = (filters: LibraryFilters) => {
    const sql = filterSql(filters, 'asset');
    return new Set(
      db.driver
        .prepare(`SELECT a.id AS id FROM assets a WHERE ${sql.where}`)
        .all(...sql.params)
        .map((row) => row.id),
    );
  };
  return { db, repos: setup.repos, trip, lisbon, sintra, guessed, nowhere, clips };
}

describe('the place and trip filters', () => {
  it('keeps the clips of a trip, a country or a city, from coordinates only', () => {
    const { trip, lisbon, sintra, clips } = library();
    expect(clips({ tripIds: [trip] })).toEqual(new Set([lisbon, sintra]));
    expect(clips({ countries: ['PT'] })).toEqual(new Set([lisbon, sintra]));
    expect(clips({ cityIds: [2262963] })).toEqual(new Set([sintra]));
    expect(clips({ countries: ['BR'] })).toEqual(new Set());
    expect(clips({ tripIds: [newId<'Trip'>()] })).toEqual(new Set());
  });

  it('never counts a time-zone guess as a country, even one stored by mistake', () => {
    const { db, guessed, clips } = library();
    db.driver.prepare(`UPDATE asset_places SET country = 'PT' WHERE asset_id = ?`).run(guessed);
    expect(clips({ countries: ['PT'] }).has(guessed)).toBe(false);
  });

  it('narrows search too, at the shot level, alongside the other filters', () => {
    const { db, repos, lisbon, guessed, trip } = library();
    const [shot] = unwrap(repos.shots.replaceForAsset(lisbon, 0, [range24(0, 48)]));
    unwrap(repos.shots.replaceForAsset(guessed, 0, [range24(0, 48)]));
    const sql = filterSql({ tripIds: [trip], countries: ['PT'], kinds: ['video'] }, 'shot');
    const rows = db.driver
      .prepare(`SELECT s.id AS id FROM shots s JOIN assets a ON a.id = s.asset_id WHERE ${sql.where}`)
      .all(...sql.params)
      .map((row) => row.id);
    expect(rows).toEqual([shot]);
  });
});
