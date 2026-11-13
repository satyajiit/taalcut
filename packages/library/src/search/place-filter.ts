// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The place and trip filters' SQL (LIB1-FIND), over place's `asset_places` (LIB1-PLACE: each asset's place, its
 * basis, country, city and trip), for the library's filters (profile/filters.ts). Countries and cities count only a
 * place from coordinates, the asset's own or a neighbour's (basis gps or nearby): a time-zone hint names countries
 * it only guesses at, so a filter never treats it as where the clip was filmed.
 */
import type { LibraryFilters } from '@taalcut/core';
import type { SqlValue } from '../driver/types';

const FROM_COORDINATES = "p.basis IN ('gps', 'nearby')";
const inList = (column: string) => `${column} IN (SELECT value FROM json_each(?))`;
/** The condition on `a`, the asset (directly, or as a shot's). */
const placed = (condition: string) =>
  `EXISTS (SELECT 1 FROM asset_places p WHERE p.asset_id = a.id AND ${condition})`;

/** Conditions for the trip, country and city filters; none when the filters ask for none. */
export function placeConditions(
  filters: Pick<LibraryFilters, 'tripIds' | 'countries' | 'cityIds'>,
): { readonly sql: string; readonly params: SqlValue[] }[] {
  const conditions: { sql: string; params: SqlValue[] }[] = [];
  if (filters.tripIds)
    conditions.push({ sql: placed(inList('p.trip_id')), params: [JSON.stringify(filters.tripIds)] });
  if (filters.countries)
    conditions.push({
      sql: placed(`${FROM_COORDINATES} AND ${inList('p.country')}`),
      params: [JSON.stringify(filters.countries)],
    });
  if (filters.cityIds)
    conditions.push({
      sql: placed(`${FROM_COORDINATES} AND ${inList('p.city_id')}`),
      params: [JSON.stringify(filters.cityIds)],
    });
  return conditions;
}
