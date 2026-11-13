// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LIB1-PLACE end to end on a database: library.placeAsset names a clip with GPS, the refresh settles its neighbours
 * and the time-zone hints (UTC+0 a real one, no offset none) and groups the trip, summaries carry both, keyword
 * search finds "Brazil" (in Hindi too) through the shots' labels, a rename sticks across refreshes, is found by its
 * new name and undoes, and a trip that loses its clips goes.
 */
import { fileURLToPath } from 'node:url';
import {
  newId,
  unwrap,
  type AssetId,
  type CommandContext,
  type MediaFacts,
  type TripId,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import {
  assetSummaries,
  createPlaceCommands,
  createPlaceRefresher,
  createRepositories,
  lazyPlaces,
  listPlaces,
  listTrips,
  placeAsset,
  PLACES_DATASET_FILE,
  refreshPlaces,
  type LibraryDatabase,
} from '../../src/index';
import { keywordMatches } from '../../src/search/fts';
import { addAssets } from '../indexing/harness';
import { openTestDb } from '../helpers';

const DATASET = fileURLToPath(new URL(`../../data/${PLACES_DATASET_FILE}`, import.meta.url));
const places = lazyPlaces(DATASET);
const HOME = 'Asia/Kolkata';
/** A synthetic moment, Mar 14, 2026, 03:00 UTC: winter in Lisbon, before Europe's clocks change. */
const T0 = Date.UTC(2026, 2, 14, 3, 0);
const H = 3_600_000;

const facts = (at: number, extra: Partial<MediaFacts> = {}): MediaFacts => ({
  version: 1,
  width: 1080,
  height: 1920,
  orientation: 'portrait',
  variableFrameRate: false,
  hdr: 'none',
  speed: 'normal',
  speedFactor: 1,
  retimedInFile: false,
  hasAudio: true,
  captureTime: new Date(at).toISOString(),
  ...extra,
});

function library(clips: readonly Partial<MediaFacts>[], times: readonly number[]) {
  const db = openTestDb();
  const repos = createRepositories(db);
  const { assets } = addAssets(
    db,
    clips.map(() => 'video'),
    { sourceName: 'Phone' },
  );
  assets.forEach((id, i) => {
    unwrap(repos.assets.setFacts(id, facts(times[i]!, clips[i])));
    unwrap(
      repos.shots.replaceForAsset(id, 0, [
        {
          start: { value: 0, rate: { num: 30, den: 1 } },
          duration: { value: 30, rate: { num: 30, den: 1 } },
        },
      ]),
    );
  });
  return { db, repos, assets };
}

async function index(db: LibraryDatabase, assets: readonly AssetId[]) {
  for (const assetId of assets) unwrap(await placeAsset({ db, places, path: DATASET }, { assetId }));
  return unwrap(
    refreshPlaces(db, { countriesAt: (o, at) => places()!.zones.countriesAt(o, at), homeZone: HOME }),
  );
}

const summaries = (db: LibraryDatabase, ids: readonly AssetId[]) =>
  assetSummaries(
    db,
    ids.map((id) => unwrap(createRepositories(db).assets.get(id))),
  );

const context = (): CommandContext => ({
  source: 'ui',
  actor: 'user',
  commandId: newId<'Command'>(),
  projectId: null,
});

describe('places and trips on a library', () => {
  it('puts two clips known only by UTC−3 in one hinted trip that search finds', async () => {
    // One file names its zone, −03:00; the other names none and is shot 3 hours later, so it borrows the zone.
    const { db, assets } = library([{ captureOffsetMin: -180 }, {}], [T0, T0 + 3 * H]);
    const outcome = await index(db, assets);
    expect(outcome).toEqual({ changed: 2, trips: 1 });
    const [a, b] = summaries(db, assets);
    expect(a!.place).toEqual({
      basis: 'zone',
      offsetMin: -180,
      offsetFrom: 'file',
      countries: ['BR', 'AR', 'CL'],
    });
    expect(b!.place).toMatchObject({ basis: 'zone', offsetFrom: 'nearby' });
    expect(a!.trip).toMatchObject({
      name: null,
      place: null,
      hint: ['BR', 'AR', 'CL'],
      month: '2026-03',
      clips: 2,
      days: 1,
    });
    expect(b!.trip?.id).toBe(a!.trip?.id);
    const shots = (id: AssetId) =>
      createRepositories(db)
        .shots.listByAsset(id)
        .map((s) => s.id);
    const found = keywordMatches(db, 'Brazil', 10);
    expect(found).toEqual(expect.arrayContaining([...shots(assets[0]!), ...shots(assets[1]!)]));
    expect(keywordMatches(db, 'ब्राज़ील', 10)).toHaveLength(2);
    // Nothing changed: nothing is written again.
    expect(
      unwrap(
        refreshPlaces(db, { countriesAt: (o, at) => places()!.zones.countriesAt(o, at), homeZone: HOME }),
      ),
    ).toEqual({ changed: 0, trips: 1 });
  });

  it('reads UTC+0 as a real offset, and no offset as none', async () => {
    // Lisbon in winter writes +00:00; a clip days later names no zone at all (only a bare UTC time).
    const { db, assets } = library([{ captureOffsetMin: 0 }, {}], [T0, T0 + 5 * 24 * H]);
    await index(db, assets);
    const [utc, unknown] = summaries(db, assets);
    expect(utc!.place).toEqual({
      basis: 'zone',
      offsetMin: 0,
      offsetFrom: 'file',
      countries: ['GB', 'CI', 'MA'],
    });
    expect(unknown!.place).toBeNull();
    expect(listTrips(db)).toEqual([]);
  });

  it('names a clip with GPS, lends its city to a neighbour, and lists the places', async () => {
    const { db, assets } = library(
      [{ captureOffsetMin: 0, location: { latitude: 38.7223, longitude: -9.1393 } }, { captureOffsetMin: 0 }],
      [T0, T0 + H],
    );
    const own = unwrap(await placeAsset({ db, places, path: DATASET }, { assetId: assets[0]! }));
    expect(own.place).toMatchObject({ basis: 'gps', city: 'Lisbon', country: 'PT' });
    await index(db, assets);
    const [lisbon, near] = summaries(db, assets);
    expect(lisbon!.place).toMatchObject({ basis: 'gps', city: 'Lisbon' });
    expect(near!.place).toMatchObject({ basis: 'nearby', city: 'Lisbon', from: assets[0], apartMs: H });
    expect(lisbon!.trip?.place).toEqual({ kind: 'countries', countries: ['PT'] });
    expect(listPlaces(db)).toEqual([
      { country: 'PT', cityId: null, city: null, region: null, clips: 2 },
      { country: 'PT', cityId: 2267057, city: 'Lisbon', region: 'Lisbon', clips: 2 },
    ]);
    expect(keywordMatches(db, 'lisbon', 10)).toHaveLength(2);
  });

  it('keeps a renamed trip across refreshes, finds it by name, undoes, and drops it with its clips', async () => {
    const { db, repos, assets } = library([{ captureOffsetMin: 0 }, { captureOffsetMin: 0 }], [T0, T0 + H]);
    await index(db, assets);
    const [trip] = listTrips(db);
    const commands = createPlaceCommands({ db });
    const renamed = unwrap(
      await commands.renameTrip.handle({ tripId: trip!.id, name: 'Surf crew' }, context()),
    );
    expect(renamed.result).toEqual({ tripId: trip!.id, name: 'Surf crew' });
    expect(keywordMatches(db, 'surf', 10)).toHaveLength(2);
    // A third clip the next day joins it; the id and the name stay.
    const { assets: more } = addAssets(db, ['video'], { sourceName: 'Phone 2' });
    unwrap(repos.assets.setFacts(more[0]!, facts(T0 + 26 * H, { captureOffsetMin: 0 })));
    await index(db, more);
    expect(listTrips(db)).toMatchObject([{ id: trip!.id, name: 'Surf crew', clips: 3, days: 2 }]);
    const undo = renamed.inverse!;
    expect(undo.payload).toEqual({ tripId: trip!.id, name: null });
    unwrap(await commands.renameTrip.handle(undo.payload as { tripId: TripId; name: null }, context()));
    expect(keywordMatches(db, 'surf', 10)).toHaveLength(0);
    expect(listTrips(db)[0]!.name).toBeNull();
    const missing = await commands.renameTrip.handle({ tripId: newId<'Trip'>(), name: 'x' }, context());
    expect(missing.ok).toBe(false);
    unwrap(repos.assets.trash([...assets, ...more]));
    await index(db, []);
    expect(listTrips(db)).toEqual([]);
  });

  it('refreshes at once while quick, and says so when the dataset is missing', async () => {
    const { db, assets } = library([{ captureOffsetMin: -180 }, { captureOffsetMin: -180 }], [T0, T0 + H]);
    for (const assetId of assets) unwrap(await placeAsset({ db, places, path: DATASET }, { assetId }));
    const refresher = createPlaceRefresher({ db, places, homeZone: HOME });
    refresher.request();
    expect(listTrips(db)).toHaveLength(1);
    refresher.flush();
    refresher.stop();
    const none = await placeAsset({ db, places: () => null, path: '/nowhere' }, { assetId: assets[0]! });
    expect(!none.ok && none.error.code).toBe('library.places_unavailable');
    const gone = await placeAsset({ db, places, path: DATASET }, { assetId: newId<'Asset'>() });
    expect(gone.ok).toBe(false);
  });
});
