// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Trips (LIB1-PLACE): the library's clips grouped by capture time and place. Pure.
 *
 * - **Home.** The person's usual time zone is this Mac's (its offset at each clip's moment, summer time included).
 *   Their usual place is the city with the most days of clips with coordinates, among clips shot at the home offset
 *   or with none named, when it has HOME_MIN_DAYS of them.
 * - **Away.** A clip with a place is away when it is more than AWAY_KM from home, or, with no home city, when it was
 *   shot at another offset; a clip with only an offset (a hint) when that offset isn't home's. Anything else is
 *   unknown: it neither starts nor ends a trip.
 * - **Trips.** In capture order, a trip runs from an away clip through the away clips after it, each within
 *   TRIP_GAP_MS of the last; a home clip ends it. Unknown clips between two of its clips are in it (a clip a
 *   sharing app stripped). It needs MIN_TRIP_CLIPS away clips.
 * - **Names.** Abroad (or with no home city), by its countries, most clips first ("Portugal", "Portugal and
 *   Spain"); at home, by the city most of its placed clips are in, else their most common region. With hints
 *   only, no place: the window says "Trip" and the hint's countries.
 * - **Identity.** A trip keeps its id (and the person's name for it) while it keeps most of its clips: each new
 *   group takes the id of the old trip it shares the most clips with, once.
 */
import type { AssetId, Place, TripPlace } from '@taalcut/core';
import { kmBetween } from './geocode';

export const TRIP_GAP_MS = 2 * 86_400_000;
export const AWAY_KM = 100;
export const HOME_MIN_DAYS = 3;
export const MIN_TRIP_CLIPS = 2;
/** At home, a city names the trip when this share of its placed clips is in it. */
const CITY_SHARE = 0.6;

export interface TripSubject {
  readonly assetId: AssetId;
  readonly capturedAt: number;
  readonly place: Place | null;
  /** Its settled UTC offset (its own or a neighbour's), minutes east; null when none. */
  readonly offsetMin: number | null;
  /** The coordinates its place stands on. */
  readonly coords: { readonly lat: number; readonly lon: number } | null;
}

export interface TripGroup {
  readonly members: readonly AssetId[];
  readonly place: TripPlace | null;
  readonly hint: readonly string[];
  /** YYYY-MM of its first clip, on the trip's own calendar. */
  readonly month: string;
  readonly startedAt: number;
  readonly endedAt: number;
  readonly days: number;
}

export interface TripOptions {
  /** This Mac's offset at `at`, minutes east; null when unknown. */
  readonly homeOffsetAt: (at: number) => number | null;
}

/** The calendar day a clip was shot on, where it was: its own offset, else home's. */
function localDay(s: TripSubject, options: TripOptions): string {
  const offset = s.offsetMin ?? options.homeOffsetAt(s.capturedAt) ?? 0;
  return new Date(s.capturedAt + offset * 60_000).toISOString().slice(0, 10);
}

const named = (p: Place | null): p is Exclude<Place, { basis: 'zone' }> => p !== null && p.basis !== 'zone';

interface Home {
  readonly cityId: number;
  readonly country: string;
  readonly lat: number;
  readonly lon: number;
}

function homeOf(subjects: readonly TripSubject[], options: TripOptions): Home | null {
  const days = new Map<number, { days: Set<string>; s: TripSubject }>();
  for (const s of subjects) {
    if (!named(s.place) || !s.coords) continue;
    const home = options.homeOffsetAt(s.capturedAt);
    if (s.offsetMin !== null && home !== null && s.offsetMin !== home) continue;
    const entry = days.get(s.place.cityId) ?? { days: new Set<string>(), s };
    entry.days.add(localDay(s, options));
    days.set(s.place.cityId, entry);
  }
  let best: { days: Set<string>; s: TripSubject } | null = null;
  for (const entry of days.values()) if (!best || entry.days.size > best.days.size) best = entry;
  if (!best || best.days.size < HOME_MIN_DAYS || !named(best.s.place) || !best.s.coords) return null;
  return { cityId: best.s.place.cityId, country: best.s.place.country, ...best.s.coords };
}

type Side = 'away' | 'home' | 'unknown';

function sideOf(s: TripSubject, home: Home | null, options: TripOptions): Side {
  const homeOffset = options.homeOffsetAt(s.capturedAt);
  if (named(s.place) && s.coords) {
    if (home) return kmBetween(home.lat, home.lon, s.coords.lat, s.coords.lon) > AWAY_KM ? 'away' : 'home';
    if (s.offsetMin === null || homeOffset === null) return 'unknown';
    return s.offsetMin === homeOffset ? 'home' : 'away';
  }
  if (s.offsetMin !== null && homeOffset !== null) return s.offsetMin === homeOffset ? 'home' : 'away';
  return 'unknown';
}

function mostCommon<T>(values: readonly T[]): [T, number] | null {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: [T, number] | null = null;
  for (const entry of counts) if (!best || entry[1] > best[1]) best = entry;
  return best;
}

function nameOf(
  members: readonly TripSubject[],
  home: Home | null,
): { place: TripPlace | null; hint: string[] } {
  const placed = members.map((m) => m.place).filter(named);
  if (placed.length === 0) {
    const zones = members.flatMap((m) => (m.place?.basis === 'zone' ? [m.place] : []));
    const offset = mostCommon(zones.map((z) => z.offsetMin));
    const hint = zones.find((z) => z.offsetMin === offset?.[0])?.countries ?? [];
    return { place: null, hint: [...hint] };
  }
  const domestic = home !== null && placed.every((p) => p.country === home.country);
  if (domestic) {
    const city = mostCommon(placed.map((p) => p.cityId))!;
    const first = placed.find((p) => p.cityId === city[0])!;
    if (city[1] >= placed.length * CITY_SHARE)
      return { place: { kind: 'city', name: first.city, country: first.country }, hint: [] };
    const region = mostCommon(placed.flatMap((p) => (p.region ? [p.region] : [])));
    if (region) return { place: { kind: 'region', name: region[0], country: home.country }, hint: [] };
    return { place: { kind: 'city', name: first.city, country: first.country }, hint: [] };
  }
  const counts = new Map<string, number>();
  for (const p of placed) counts.set(p.country, (counts.get(p.country) ?? 0) + 1);
  const countries = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([c]) => c);
  return { place: { kind: 'countries', countries: countries.slice(0, 3) }, hint: [] };
}

/** The trips among these clips, oldest first. */
export function groupTrips(subjects: readonly TripSubject[], options: TripOptions): TripGroup[] {
  const sorted = [...subjects].sort(
    (a, b) => a.capturedAt - b.capturedAt || a.assetId.localeCompare(b.assetId),
  );
  const home = homeOf(sorted, options);
  const sides = sorted.map((s) => sideOf(s, home, options));
  const groups: TripGroup[] = [];
  let i = 0;
  while (i < sorted.length) {
    if (sides[i] !== 'away') {
      i += 1;
      continue;
    }
    // From the first away clip, through every away clip within the gap of the last, until a home clip.
    let last = i;
    let away = 1;
    let j = i + 1;
    for (; j < sorted.length; j += 1) {
      if (sides[j] === 'home') break;
      if (sorted[j]!.capturedAt - sorted[last]!.capturedAt > TRIP_GAP_MS) break;
      if (sides[j] === 'away') {
        last = j;
        away += 1;
      }
    }
    if (away >= MIN_TRIP_CLIPS) {
      const members = sorted.slice(i, last + 1);
      const days = new Set(members.map((m) => localDay(m, options)));
      groups.push({
        members: members.map((m) => m.assetId),
        ...nameOf(members, home),
        month: localDay(members[0]!, options).slice(0, 7),
        startedAt: members[0]!.capturedAt,
        endedAt: members[members.length - 1]!.capturedAt,
        days: days.size,
      });
    }
    i = last + 1;
  }
  return groups;
}

export interface KnownTrip<Id extends string> {
  readonly id: Id;
  readonly members: ReadonlySet<AssetId>;
}

/**
 * Each group with the id it keeps: the old trip it shares the most clips with (each old trip once, the biggest
 * overlaps first), else a new one. Old trips no group took are gone.
 */
export function matchTrips<Id extends string>(
  groups: readonly TripGroup[],
  known: readonly KnownTrip<Id>[],
  newId: () => Id,
): { id: Id; group: TripGroup; kept: boolean }[] {
  const tripOf = new Map<AssetId, number>();
  known.forEach((trip, k) => trip.members.forEach((id) => tripOf.set(id, k)));
  const pairs: { g: number; k: number; shared: number }[] = [];
  groups.forEach((group, g) => {
    const shared = new Map<number, number>();
    for (const id of group.members) {
      const k = tripOf.get(id);
      if (k !== undefined) shared.set(k, (shared.get(k) ?? 0) + 1);
    }
    for (const [k, n] of shared) pairs.push({ g, k, shared: n });
  });
  pairs.sort((a, b) => b.shared - a.shared || a.g - b.g || a.k - b.k);
  const taken = new Map<number, Id>();
  const used = new Set<number>();
  for (const { g, k } of pairs) {
    if (taken.has(g) || used.has(k)) continue;
    taken.set(g, known[k]!.id);
    used.add(k);
  }
  return groups.map((group, g) => {
    const id = taken.get(g);
    return id === undefined ? { id: newId(), group, kept: false } : { id, group, kept: true };
  });
}
