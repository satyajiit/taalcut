// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The ShotCatalog over core's VectorIndex: one hit per shot (its best frame), filters applied, cosine per metric. */
import {
  newId,
  ok,
  type ShotProfile,
  type ShotProfileSource,
  type VectorIndex,
  type VectorMatch,
  type VectorMetric,
  type VectorSearchOptions,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { profileKey } from '../src/casting/catalog';
import { vectorShotCatalog } from '../src/casting/vector-catalog';
import { makeProfile, unitVector } from './fixtures/library';

function fakeIndex(
  metric: VectorMetric,
  matches: VectorMatch[],
): VectorIndex & { asked: VectorSearchOptions[] } {
  const asked: VectorSearchOptions[] = [];
  return {
    name: 'fake',
    dimensions: 16,
    metric,
    asked,
    upsert: () => ok(0),
    remove: () => ok(0),
    removeWhere: () => ok(0),
    ids: () => ok([]),
    replaceWhere: () => ok(0),
    get: () => ok(new Map()),
    search: (_query, options) => {
      asked.push(options);
      return ok(matches);
    },
    count: () => matches.length,
    drop: () => ok(undefined),
  };
}

function source(profiles: readonly ShotProfile[]): ShotProfileSource & { refs: unknown[] } {
  const refs: unknown[] = [];
  return {
    refs,
    profiles: async (wanted) => {
      refs.push(...wanted);
      const keys = new Set(wanted.map((ref) => (ref.shotId ? ref.shotId : `asset:${ref.assetId}`)));
      return ok(profiles.filter((profile) => keys.has(profileKey(profile))));
    },
    list: async (_filter, limit) => ok(profiles.slice(0, limit)),
    recent: async (limit) => ok(profiles.slice(0, limit).map((profile) => profile.embedding)),
  };
}

const match = (id: string, distance: number, assetId: string | null = null): VectorMatch => ({
  id,
  distance,
  metadata: { assetId, sourceId: null, kind: 'frame' },
});

describe('vectorShotCatalog', () => {
  const portrait = makeProfile({ embedding: unitVector(1) });
  const landscape = makeProfile({ embedding: unitVector(2), orientation: 'landscape' });
  const photo = makeProfile({ embedding: unitVector(3), kind: 'image' });

  it("keeps each shot's best frame, filters, and sorts by cosine", async () => {
    const index = fakeIndex('cosine', [
      match(`frame:${portrait.shotId}:0`, 0.4),
      match(`frame:${portrait.shotId}:1`, 0.1),
      match(`frame:${landscape.shotId}:0`, 0.05),
      match(`frame:asset:${photo.assetId}`, 0.2),
      match('broken', 0),
    ]);
    const catalog = vectorShotCatalog({ index, profiles: source([portrait, landscape, photo]) });
    const hits = await catalog.nearest(unitVector(9), { orientations: ['portrait'] }, 5);
    expect(hits.ok && hits.value.map((hit) => profileKey(hit.profile))).toEqual([
      profileKey(portrait),
      profileKey(photo),
    ]);
    expect(hits.ok && hits.value[0]!.cosine).toBeCloseTo(0.9, 9);
    expect(index.asked[0]).toMatchObject({ filter: { kind: 'frame' } });
    expect(index.asked[0]!.k).toBeGreaterThan(5);
  });

  it("scores a photo the library embedded as its still's one shot by its asset", async () => {
    const stillShot = newId<'Shot'>();
    const index = fakeIndex('cosine', [match(`frame:${stillShot}:0`, 0.3, photo.assetId)]);
    const profiles: ShotProfileSource = {
      ...source([photo]),
      profiles: async (refs) => ok(refs.some((ref) => ref.shotId === stillShot) ? [photo] : []),
    };
    const hits = await vectorShotCatalog({ index, profiles }).nearest(unitVector(9), {}, 5);
    expect(hits.ok && hits.value.map((hit) => profileKey(hit.profile))).toEqual([profileKey(photo)]);
    expect(hits.ok && hits.value[0]!.cosine).toBeCloseTo(0.7, 9);
  });

  it('reads L2 distances of unit vectors as cosine, caps k, and passes source filters', async () => {
    const sourceId = newId<'Source'>();
    const imported = { ...portrait, sourceId };
    const index = fakeIndex('l2', [match(`frame:${portrait.shotId}:0`, 1)]);
    const catalog = vectorShotCatalog({ index, profiles: source([imported]) });
    const sourceIds = [sourceId];
    const hits = await catalog.nearest(unitVector(9), { sourceIds }, 100_000);
    expect(hits.ok && hits.value[0]!.cosine).toBeCloseTo(0.5, 9);
    expect(index.asked[0]).toMatchObject({ k: 4096, filter: { kind: 'frame', sourceId: sourceIds } });
  });

  it('passes list, profiles and recent through to the library', async () => {
    const profiles = source([portrait, landscape]);
    const catalog = vectorShotCatalog({ index: fakeIndex('cosine', []), profiles });
    const listed = await catalog.list({}, 1);
    expect(listed.ok && listed.value).toEqual([portrait]);
    const recent = await catalog.recent(2);
    expect(recent.ok && recent.value.length).toBe(2);
    const read = await catalog.profiles([{ assetId: landscape.assetId, shotId: landscape.shotId }]);
    expect(read.ok && read.value).toEqual([landscape]);
  });
});
