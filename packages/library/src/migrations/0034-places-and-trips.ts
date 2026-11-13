// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Places and trips (LIB1-PLACE): `trips`, the library's clips grouped by time and place (derived, rebuilt by the
 * library.place stage; only `name` is the person's), and `asset_places`, each asset's place in words and its trip.
 * Both are derived from the assets, so an asset's row goes with it (cascade) and a trip that loses its last clip
 * goes when the next rebuild runs.
 *
 * Keyword search: `asset_places.search_text` (the place and trip words: city, region, country names, a hint's
 * countries, the trip's name) joins each of the asset's shots' `labels` in `shot_fts`, beside the objects, the
 * described place and the shot type. The shot triggers of migration 13 are recreated to read it, and three triggers
 * on `asset_places` rewrite the labels of the asset's shots when it changes. No FTS rebuild: no asset has a place yet.
 */
import type { Migration } from './types';

/** Migration 13's labels: objects, the described place and the shot type, as words. */
const labels = (shot: string) =>
  `trim(coalesce(replace(${shot}.objects, char(31), ' '), '') || ' ' || coalesce(${shot}.place, '') || ' ' ||
    coalesce(replace(${shot}.shot_type, '_', ' '), ''))`;

/** The labels with the asset's place and trip words after them. */
export const labelsWithPlace = (shot: string) =>
  `trim(${labels(shot)} || ' ' ||
    coalesce((SELECT search_text FROM asset_places WHERE asset_id = ${shot}.asset_id), ''))`;

const rowOf = (shotId: string) => `(SELECT rowid FROM shot_search_rows WHERE shot_id = ${shotId})`;
const fileName = (shot: string) => `(SELECT original_filename FROM assets WHERE id = ${shot}.asset_id)`;

/** Every shot of the asset gets its labels again, from `label(s)`. */
const relabel = (assetId: string, label: (shot: string) => string) => `
  UPDATE shot_fts SET labels = (
    SELECT ${label('s')} FROM shot_search_rows r JOIN shots s ON s.id = r.shot_id WHERE r.rowid = shot_fts.rowid)
  WHERE rowid IN (
    SELECT r.rowid FROM shot_search_rows r JOIN shots s ON s.id = r.shot_id WHERE s.asset_id = ${assetId});`;

const shotTriggers = (label: (shot: string) => string) => `
CREATE TRIGGER shot_fts_on_insert AFTER INSERT ON shots BEGIN
  INSERT INTO shot_search_rows (shot_id) VALUES (NEW.id);
  INSERT INTO shot_fts (rowid, description, labels, on_screen_text, transcript, file_name)
    VALUES (${rowOf('NEW.id')}, NEW.description, ${label('NEW')}, NEW.on_screen_text, NEW.transcript_text,
      ${fileName('NEW')});
END;

CREATE TRIGGER shot_fts_on_update
AFTER UPDATE OF description, objects, place, shot_type, on_screen_text, transcript_text ON shots BEGIN
  UPDATE shot_fts SET description = NEW.description, labels = ${label('NEW')},
      on_screen_text = NEW.on_screen_text, transcript = NEW.transcript_text
    WHERE rowid = ${rowOf('NEW.id')};
END;
`;

const up = `
CREATE TABLE trips (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT CHECK (name IS NULL OR length(name) BETWEEN 1 AND 120),
  place TEXT CHECK (place IS NULL OR json_valid(place)),
  hint TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(hint)),
  month TEXT NOT NULL CHECK (length(month) = 7),
  started_at INTEGER NOT NULL,
  ended_at INTEGER NOT NULL CHECK (ended_at >= started_at),
  clips INTEGER NOT NULL CHECK (clips > 0),
  days INTEGER NOT NULL CHECK (days > 0),
  search_text TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;
CREATE INDEX trips_started_idx ON trips(started_at);

CREATE TABLE asset_places (
  asset_id TEXT PRIMARY KEY NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  own TEXT CHECK (own IS NULL OR json_valid(own)),
  place TEXT CHECK (place IS NULL OR json_valid(place)),
  basis TEXT CHECK (basis IS NULL OR basis IN ('gps', 'nearby', 'zone')),
  country TEXT CHECK (country IS NULL OR length(country) = 2),
  city_id INTEGER,
  trip_id TEXT REFERENCES trips(id) ON DELETE SET NULL,
  search_text TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
) STRICT;
CREATE INDEX asset_places_trip_idx ON asset_places(trip_id) WHERE trip_id IS NOT NULL;
CREATE INDEX asset_places_country_idx ON asset_places(country, city_id) WHERE country IS NOT NULL;

DROP TRIGGER shot_fts_on_insert;
DROP TRIGGER shot_fts_on_update;
${shotTriggers(labelsWithPlace)}
CREATE TRIGGER asset_places_fts_on_insert AFTER INSERT ON asset_places BEGIN
${relabel('NEW.asset_id', labelsWithPlace)}
END;

CREATE TRIGGER asset_places_fts_on_update AFTER UPDATE OF search_text ON asset_places
WHEN NEW.search_text IS NOT OLD.search_text BEGIN
${relabel('NEW.asset_id', labelsWithPlace)}
END;

CREATE TRIGGER asset_places_fts_on_delete AFTER DELETE ON asset_places BEGIN
${relabel('OLD.asset_id', labels)}
END;
`;

const down = `
DROP TRIGGER asset_places_fts_on_delete;
DROP TRIGGER asset_places_fts_on_update;
DROP TRIGGER asset_places_fts_on_insert;
DROP TRIGGER shot_fts_on_insert;
DROP TRIGGER shot_fts_on_update;
${shotTriggers(labels)}
UPDATE shot_fts SET labels = (
  SELECT ${labels('s')} FROM shot_search_rows r JOIN shots s ON s.id = r.shot_id WHERE r.rowid = shot_fts.rowid);
DROP INDEX asset_places_country_idx;
DROP INDEX asset_places_trip_idx;
DROP TABLE asset_places;
DROP INDEX trips_started_idx;
DROP TABLE trips;
`;

export const placesAndTrips: Migration = { version: 34, name: 'places_and_trips', up, down };
