// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What people in the fake library's clips are doing (LIB1-FIND), by the library's rules: a clip shows its scene's
 * actions once it is described; the action filter keeps a clip with any of them; `library.actions` counts the
 * clips that show each, most first, the trash and missing originals left out as the library leaves them out.
 * The trip, country and city filters read the clip's place and trip as place's fake set them (fake-places.ts):
 * a country or a city counts only a place from coordinates (gps, nearby), never a time-zone guess.
 */
import type { ActionCount, AssetSummary, LibraryFilters } from '@taalcut/core';
import type { FakeAsset } from './assets';
import { SCENES } from './scenes';

/** The clip's actions, once described; none before. */
export function actionsOf(asset: FakeAsset): readonly string[] {
  return asset.summary.description === null ? [] : (SCENES[asset.extras.scene]?.actions ?? []);
}

/** The action filter: a clip showing any of the asked actions. */
export function matchesActions(asset: FakeAsset, filters: LibraryFilters | undefined): boolean {
  if (!filters?.actions) return true;
  const shown = actionsOf(asset);
  return filters.actions.some((action) => shown.includes(action));
}

/** The trip, country and city filters, as the library's place-filter.ts reads asset_places. */
export function matchesPlaces(summary: AssetSummary, filters: LibraryFilters | undefined): boolean {
  if (filters?.tripIds && !(summary.trip && filters.tripIds.includes(summary.trip.id))) return false;
  if (!filters?.countries && !filters?.cityIds) return true;
  const place = summary.place;
  if (!place || place.basis === 'zone') return false;
  if (filters.countries && !filters.countries.includes(place.country)) return false;
  return !filters.cityIds || filters.cityIds.includes(place.cityId);
}

/** Every filter LIB1-FIND added: actions, trips, countries and cities. */
export function matchesFindFilters(asset: FakeAsset, filters: LibraryFilters | undefined): boolean {
  return matchesActions(asset, filters) && matchesPlaces(asset.summary, filters);
}

/** The action filter's choices: every action the `visible` clips show, with how many, most first. */
export function fakeActionCounts(
  assets: readonly FakeAsset[],
  visible: (summary: AssetSummary) => boolean,
): ActionCount[] {
  const counts = new Map<string, number>();
  for (const asset of assets) {
    if (!visible(asset.summary)) continue;
    for (const action of actionsOf(asset)) counts.set(action, (counts.get(action) ?? 0) + 1);
  }
  return [...counts]
    .map(([action, assets]) => ({ action, assets }))
    .sort((a, b) => b.assets - a.assets || a.action.localeCompare(b.action));
}
