// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The Drizzle tables for places and trips (LIB1-PLACE, migration 34). Both are derived from the assets by the
 * library.place stage's rebuild (places/refresh.ts); a trip's `name` is the only thing the person sets. JSON columns
 * are read back through core's schemas.
 */
import type { AssetId, TripId } from '@taalcut/core';
import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { assets } from '../schema/library';

export const trips = sqliteTable(
  'trips',
  {
    id: text('id').$type<TripId>().primaryKey(),
    /** The person's name for it; null: the automatic one. */
    name: text('name'),
    /** core's TripPlace as JSON; null when no clip of it has a place. */
    place: text('place', { mode: 'json' }).$type<unknown>(),
    /** Country codes a time zone names, as JSON. */
    hint: text('hint', { mode: 'json' }).$type<string[]>().notNull().default([]),
    /** YYYY-MM, on the trip's own calendar. */
    month: text('month').notNull(),
    startedAt: integer('started_at').notNull(),
    endedAt: integer('ended_at').notNull(),
    clips: integer('clips').notNull(),
    days: integer('days').notNull(),
    /** Its words for keyword search: the name and the place's. */
    searchText: text('search_text').notNull().default(''),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('trips_started_idx').on(t.startedAt)],
);

export const assetPlaces = sqliteTable(
  'asset_places',
  {
    assetId: text('asset_id')
      .$type<AssetId>()
      .primaryKey()
      .references(() => assets.id, { onDelete: 'cascade' }),
    /** core's Place from its own coordinates ('gps'), as library.place found it; null without any. */
    own: text('own', { mode: 'json' }).$type<unknown>(),
    /** core's Place as shown: its own, a neighbour's, or a time-zone hint; null when nothing says. */
    place: text('place', { mode: 'json' }).$type<unknown>(),
    basis: text('basis', { enum: ['gps', 'nearby', 'zone'] }),
    /** For filters: the named city's country (not a hint's). */
    country: text('country'),
    /** For filters: the named city's GeoNames id. */
    cityId: integer('city_id'),
    tripId: text('trip_id')
      .$type<TripId>()
      .references(() => trips.id, { onDelete: 'set null' }),
    /** Place and trip words for keyword search, read into shot_fts' labels by trigger. */
    searchText: text('search_text').notNull().default(''),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('asset_places_trip_idx')
      .on(t.tripId)
      .where(sql`${t.tripId} IS NOT NULL`),
    index('asset_places_country_idx')
      .on(t.country, t.cityId)
      .where(sql`${t.country} IS NOT NULL`),
  ],
);

export type TripRow = typeof trips.$inferSelect;
export type AssetPlaceRow = typeof assetPlaces.$inferSelect;
