// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// LIB1-PLACE: the fake library's places and trips parse as core's: a Portugal trip from coordinates (with a
// neighbour's city and a time-zone hint among its clips), a trip known only by UTC−3, home in Bengaluru, and the
// sample clips in Goa; a clip's coordinates match its place; renameTrip names every clip of the trip, and Undo
// takes it back.
import {
  assetDetailSchema,
  assetSummarySchema,
  callRpc,
  PLACE_COMMANDS,
  tripSchema,
  type AssetDetail,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createFakeBackend } from '../src/backend/fake/fake-backend';
import { SAMPLE } from '../e2e/clip-samples';
import { PLACE_CLIPS } from '../e2e/place-clips';

function setup() {
  const { client } = createFakeBackend({ phase2: { library: { tickMs: 0 } } });
  const dispatch = (name: string, payload: unknown) =>
    callRpc(client.commands.dispatch({ name, payload, source: 'ui' }));
  const undo = () => callRpc(client.commands.undo({ projectId: null, source: 'ui' }));
  const all = async () => {
    const seen: AssetDetail['asset'][] = [];
    let cursor: string | undefined;
    do {
      const page = await client.library.browse({ limit: 200, ...(cursor ? { cursor } : {}) });
      seen.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor);
    return seen;
  };
  return { client, dispatch, undo, all };
}

describe('the fake’s places and trips', () => {
  it('names places and two trips that parse as core’s', async () => {
    const { client, all } = setup();
    const { trips } = await client.library.trips({});
    expect(trips.map((trip) => [trip.place, trip.hint, trip.month])).toEqual([
      [{ kind: 'countries', countries: ['PT'] }, [], '2026-09'],
      [null, ['BR', 'AR', 'PY'], '2026-06'],
    ]);
    for (const trip of trips) {
      expect(tripSchema.safeParse(trip).error?.issues ?? []).toEqual([]);
      expect(trip.clips).toBeGreaterThanOrEqual(2);
    }
    const clips = await all();
    for (const clip of clips.filter((c) => c.place || c.trip))
      expect(assetSummarySchema.safeParse(clip).error?.issues ?? []).toEqual([]);
    const portugal = clips.filter((clip) => clip.trip?.id === trips[0]!.id);
    expect(portugal).toHaveLength(trips[0]!.clips);
    expect(new Set(portugal.map((clip) => clip.place?.basis))).toEqual(new Set(['gps', 'nearby', 'zone']));
    expect(portugal.every((clip) => clip.captureOffset?.minutes === 60)).toBe(true);
    expect(clips.some((clip) => clip.place?.basis === 'gps' && clip.place.city === 'Bengaluru')).toBe(true);
    const { places } = await client.library.places({});
    expect(places[0]).toMatchObject({ city: 'Bengaluru', country: 'IN' });
  });

  it('gives a clip the coordinates its place came from, and none for a guess', async () => {
    const { client, all } = setup();
    const clips = await all();
    const lisbon = clips.find((clip) => clip.place?.basis === 'gps' && clip.place.city === 'Lisbon')!;
    const guess = clips.find((clip) => clip.place?.basis === 'nearby')!;
    const [a, b] = await Promise.all(
      [lisbon, guess].map((clip) => client.library.asset({ assetId: clip.id })),
    );
    expect(assetDetailSchema.safeParse(a).error?.issues ?? []).toEqual([]);
    expect(a?.facts?.location).toEqual({ latitude: 38.7223, longitude: -9.1393 });
    expect(b?.facts?.location).toBeUndefined();
    const sample = await client.library.asset({ assetId: SAMPLE.landscape as AssetDetail['asset']['id'] });
    expect(sample?.asset.place).toMatchObject({ basis: 'gps', city: 'Morjim', region: 'Goa' });
    expect(sample?.facts?.location).toEqual({ latitude: 15.6311, longitude: 73.7372 });
  });

  it('has the clips the e2e opens, each with its kind of place', async () => {
    const { client } = setup();
    const place = async (id: string) =>
      (await client.library.asset({ assetId: id as AssetDetail['asset']['id'] }))?.asset;
    expect((await place(PLACE_CLIPS.lisbon))?.place).toMatchObject({ basis: 'gps', city: 'Lisbon', km: 0 });
    expect((await place(PLACE_CLIPS.nearCascais))?.place).toMatchObject({
      basis: 'gps',
      city: 'Cascais',
      km: 19,
    });
    expect((await place(PLACE_CLIPS.borrowed))?.place).toMatchObject({ basis: 'nearby', city: 'Sintra' });
    expect((await place(PLACE_CLIPS.zone))?.place).toMatchObject({ basis: 'zone', offsetMin: 60 });
    const hinted = await place(PLACE_CLIPS.hinted);
    expect(hinted?.place).toMatchObject({ basis: 'zone', offsetMin: -180, countries: ['BR', 'AR', 'PY'] });
    expect(hinted?.trip).toMatchObject({ place: null, hint: ['BR', 'AR', 'PY'] });
  });

  it('renames a trip on every clip in it, and Undo takes the name back', async () => {
    const { client, dispatch, undo, all } = setup();
    const [trip] = (await client.library.trips({})).trips;
    expect((await dispatch(PLACE_COMMANDS.renameTrip, { tripId: trip!.id, name: 'Honeymoon' })).ok).toBe(
      true,
    );
    const named = (await all()).filter((clip) => clip.trip?.id === trip!.id);
    expect(named.every((clip) => clip.trip?.name === 'Honeymoon')).toBe(true);
    expect((await client.library.trips({})).trips[0]?.name).toBe('Honeymoon');
    expect((await undo()).ok).toBe(true);
    expect((await client.library.trips({})).trips[0]?.name).toBeNull();
  });
});
