// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* eslint-disable lingui/no-unlocalized-strings -- the GeoNames names of cities and regions: data, never translated */

/**
 * The fake library's places and trips (LIB1-PLACE), as the jobs process would settle them; the names, regions and
 * distances are what the real geocoder answers for these coordinates over the bundled GeoNames set, and the hints
 * what its time-zone ranking answers on those days.
 *
 * - Home is Bengaluru: a phone clip whose file has a location is there.
 * - Sep 12 to 15, 2026, in Portugal (UTC+1, summer time, the files name it), past the import still being looked
 *   through: Lisbon, Sintra, Porto and Cascais from their own coordinates, now and then a clip borrowing the city of
 *   one shot within three hours, the odd one known only by its time zone. One trip, "Portugal · Sep 2026".
 * - Jun 13 to 15, 2026: a trip with no coordinates at all, only UTC−3 in its files: "Trip · Jun 2026", probably
 *   Brazil, Argentina or Paraguay.
 * - The sample clips (sample-clips.ts) are at Calangute and Morjim in Goa, where their files say.
 *
 * renameTrip names a trip (null: its automatic name again) on every clip in it, with its inverse for Undo.
 */
import {
  defineCommand,
  ok,
  PLACE_COMMANDS,
  placeCommandPayloads,
  type AnyCommand,
  type AssetDetail,
  type AssetSummary,
  type EventBus,
  type Place,
  type PlaceCount,
  type Trip,
  type TripId,
} from '@taalcut/core';
import { KIND, type FakeAsset } from './assets';
import { SCENES } from './scenes';
import { fakeUlid } from './seed';

/** Trips' fake ids (seed.ts fakeUlid): a kind no other fake uses. */
const TRIP_KIND = 12;

type GpsPlace = Extract<Place, { basis: 'gps' }>;
type City = Omit<GpsPlace, 'basis'> & { readonly latitude: number; readonly longitude: number };

const city = (
  cityId: number,
  name: string,
  region: string,
  country: string,
  latitude: number,
  longitude: number,
  km = 0,
): City => ({ cityId, city: name, region, country, km, latitude, longitude });

const BENGALURU = city(1277333, 'Bengaluru', 'Karnataka', 'IN', 12.9716, 77.5946);
const PORTUGAL = [
  city(2267057, 'Lisbon', 'Lisbon', 'PT', 38.7223, -9.1393),
  city(2262912, 'Sintra', 'Lisbon', 'PT', 38.7979, -9.3906),
  city(2735943, 'Porto', 'Porto', 'PT', 41.1579, -8.6291),
  city(2269594, 'Cascais', 'Lisbon', 'PT', 38.6979, -9.4215),
  // On a boat off the coast: 19 km past Cascais, so "Near Cascais".
  city(2269594, 'Cascais', 'Lisbon', 'PT', 38.65, -9.65, 19),
];
const SAMPLE_PLACES: Readonly<Record<number, City>> = {
  90_101: city(1273858, 'Calangute', 'Goa', 'IN', 15.5553, 73.7517, 1),
  90_102: city(1262768, 'Morjim', 'Goa', 'IN', 15.6311, 73.7372),
};

const HOURS = 3_600_000;
/** Each trip: its window in UTC (midnight to midnight where it was), its files' offset, and that offset's hint. */
const AWAY = [
  {
    n: 1,
    from: Date.UTC(2026, 8, 11, 23),
    to: Date.UTC(2026, 8, 15, 23),
    zone: 60,
    hint: ['NG', 'GB', 'AO'],
    country: 'PT',
  },
  {
    n: 2,
    from: Date.UTC(2026, 5, 13, 3),
    to: Date.UTC(2026, 5, 16, 3),
    zone: -180,
    hint: ['BR', 'AR', 'PY'],
    country: null,
  },
] as const;
type Away = (typeof AWAY)[number];

const gps = ({ latitude: _la, longitude: _lo, ...rest }: City): GpsPlace => ({ basis: 'gps', ...rest });

/** Where a generated clip was on its own, and its zone when the file names one. */
function ownPlaceOf(asset: FakeAsset, away: Away | null): Partial<AssetSummary> {
  const { summary, extras } = asset;
  if (summary.capturedAt === null || summary.kind === 'audio') return {};
  if (!away) {
    const located =
      SCENES[extras.scene]?.place && summary.sourceIds[0] === fakeUlid<'Source'>(KIND.source, 1);
    return located ? { place: gps(BENGALURU) } : {};
  }
  const hint = (from: 'file' | 'nearby'): Partial<AssetSummary> => ({
    captureOffset: { minutes: away.zone, from },
    place: { basis: 'zone', offsetMin: away.zone, offsetFrom: from, countries: [...away.hint] },
  });
  if (!away.country) return hint('file');
  // One in eight names no zone and has no neighbour with coordinates: it borrows only a neighbour's offset.
  if (extras.n % 8 === 2) return hint('nearby');
  // Clips come four at a time from one place, as a day out does.
  const own = PORTUGAL[Math.floor(extras.n / 4) % PORTUGAL.length]!;
  return { captureOffset: { minutes: away.zone, from: 'file' }, place: gps(own) };
}

/** One in four clips of a trip with coordinates has none of its own: it borrows the city of one within 3 hours. */
function borrowCities(clips: FakeAsset[]): FakeAsset[] {
  const located = clips.filter((clip) => clip.summary.place?.basis === 'gps' && clip.extras.n % 4 !== 0);
  return clips.map((clip) => {
    if (clip.extras.n % 4 !== 0 || clip.summary.place?.basis !== 'gps') return clip;
    const at = clip.summary.capturedAt!;
    const nearest = located
      .map((other) => ({ other, apartMs: Math.abs(other.summary.capturedAt! - at) }))
      .sort((a, b) => a.apartMs - b.apartMs)[0];
    const from = nearest?.other.summary.place;
    if (!nearest || nearest.apartMs > 3 * HOURS || from?.basis !== 'gps') return clip;
    const { basis: _basis, ...named } = from;
    const place: Place = {
      ...named,
      basis: 'nearby',
      from: nearest.other.summary.id,
      apartMs: nearest.apartMs,
    };
    return { ...clip, summary: { ...clip.summary, place } };
  });
}

/**
 * The library's clips with their places and trips: generated ones by when they were shot, the samples by n. With
 * `trips: false` (the clip page's edge cases, outside the grid), only the samples' own places.
 */
export function withPlaces(assets: readonly FakeAsset[], options: { trips?: boolean } = {}): FakeAsset[] {
  const trips = options.trips ?? true;
  const placed = assets.map((asset): FakeAsset => {
    const sample = SAMPLE_PLACES[asset.extras.n];
    if (sample) return { ...asset, summary: { ...asset.summary, place: gps(sample) } };
    if (!trips) return asset;
    const at = asset.summary.capturedAt;
    const away = at === null ? null : (AWAY.find((a) => at >= a.from && at < a.to) ?? null);
    return { ...asset, summary: { ...asset.summary, ...ownPlaceOf(asset, away) } };
  });
  if (!trips) return placed;
  for (const away of AWAY) {
    const inside = placed.filter((clip) => {
      const at = clip.summary.capturedAt;
      return at !== null && at >= away.from && at < away.to && clip.summary.place;
    });
    if (inside.length < 2) continue;
    const clips = away.country ? borrowCities(inside) : inside;
    const times = clips.map((clip) => clip.summary.capturedAt!);
    const local = (time: number) => new Date(time + away.zone * 60_000).toISOString();
    const startedAt = Math.min(...times);
    const trip: Trip = {
      id: fakeUlid<'Trip'>(TRIP_KIND, away.n) as TripId,
      name: null,
      place: away.country ? { kind: 'countries', countries: [away.country] } : null,
      hint: away.country ? [] : [...away.hint],
      month: local(startedAt).slice(0, 7),
      startedAt,
      endedAt: Math.max(...times),
      clips: clips.length,
      days: new Set(times.map((time) => local(time).slice(0, 10))).size,
    };
    // borrowCities keeps the order: clips[i] is inside[i], placed.
    clips.forEach((clip, i) => {
      placed[placed.indexOf(inside[i]!)] = { ...clip, summary: { ...clip.summary, trip } };
    });
  }
  return placed;
}

type Shot = AssetDetail['shots'][number];

/** A shot without the place the describing model named (the fake's scenes name places in Goa). */
function withoutModelPlace(shot: Shot): Shot {
  const description = shot.analysis?.description;
  if (!shot.analysis || !description?.place) return shot;
  const { place: _place, ...rest } = description;
  return { ...shot, analysis: { ...shot.analysis, description: rest } };
}

/**
 * A generated clip's detail with the coordinates its place was named from, and none when its place came from a
 * neighbour or a time zone; a clip on a trip loses the scene's place, which is in Goa; a sample clip's detail keeps
 * its file's own.
 */
export function placeDetail<D extends AssetDetail | null>(asset: FakeAsset, detail: D): D {
  if (!detail?.facts || SAMPLE_PLACES[asset.extras.n]) return detail;
  const place = asset.summary.place;
  const named =
    place?.basis === 'gps'
      ? [BENGALURU, ...PORTUGAL].find((known) => known.cityId === place.cityId && known.km === place.km)
      : undefined;
  const { location: _location, ...facts } = detail.facts;
  return {
    ...detail,
    facts: named ? { ...facts, location: { latitude: named.latitude, longitude: named.longitude } } : facts,
    shots: asset.summary.trip ? detail.shots.map(withoutModelPlace) : detail.shots,
  };
}

const countryNames = new Intl.DisplayNames(['en'], { type: 'region' });

/** What search finds a clip by, as the library's asset_places.search_text: its city, region, country and trip. */
export function placeWords(summary: AssetSummary): string {
  const place = summary.place;
  const countries = !place ? [] : place.basis === 'zone' ? place.countries : [place.country];
  return [
    ...(place && place.basis !== 'zone' ? [place.city, place.region ?? ''] : []),
    ...countries.map((code) => countryNames.of(code) ?? code),
    summary.trip?.name ?? '',
  ].join(' ');
}

/** Every trip in the library, newest first. */
export function fakeTrips(assets: readonly FakeAsset[]): Trip[] {
  const trips = new Map<string, Trip>();
  for (const { summary } of assets)
    if (summary.trip && !summary.trashed) trips.set(summary.trip.id, summary.trip);
  return [...trips.values()].sort((a, b) => b.startedAt - a.startedAt);
}

/** Every place clips were named at, with how many. */
export function fakePlaceCounts(assets: readonly FakeAsset[]): PlaceCount[] {
  const counts = new Map<string, PlaceCount>();
  for (const { summary } of assets) {
    const place = summary.place;
    if (!place || place.basis === 'zone' || summary.trashed) continue;
    const key = `${place.country}:${place.cityId}`;
    const count = counts.get(key);
    counts.set(
      key,
      count
        ? { ...count, clips: count.clips + 1 }
        : { country: place.country, cityId: place.cityId, city: place.city, region: place.region, clips: 1 },
    );
  }
  return [...counts.values()].sort((a, b) => b.clips - a.clips);
}

export interface FakePlaceStore {
  readonly all: () => readonly FakeAsset[];
  readonly put: (asset: FakeAsset) => void;
}

export function fakePlaceCommands(events: EventBus, store: FakePlaceStore): AnyCommand[] {
  return [
    defineCommand({
      name: PLACE_COMMANDS.renameTrip,
      payload: placeCommandPayloads[PLACE_COMMANDS.renameTrip],
      sideEffect: 'write',
      project: () => null,
      handle: async ({ tripId, name }) => {
        const members = store.all().filter((asset) => asset.summary.trip?.id === tripId);
        const before = members[0]?.summary.trip?.name ?? null;
        for (const asset of members)
          store.put({ ...asset, summary: { ...asset.summary, trip: { ...asset.summary.trip!, name } } });
        if (members.length > 0)
          events.emit('library.changed', {
            projectId: null,
            entity: 'asset',
            change: 'updated',
            ids: members.map((asset) => asset.summary.id),
          });
        return ok({
          result: { tripId },
          inverse: { name: PLACE_COMMANDS.renameTrip, payload: { tripId, name: before } },
        });
      },
    }),
  ];
}
