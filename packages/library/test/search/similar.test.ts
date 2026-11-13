// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** P2-L10 find similar: the shot's own frame and description vectors, no keywords, no embedder. */
import { newId, searchResultSchema, unwrap, type ShotId } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createLibrarySearch, meanVector } from '../../src/index';
import { searchFixture } from './search-helpers';

describe('find similar', () => {
  it('finds shots of the same kind of scene, leaving out the shot and its asset', async () => {
    const s = searchFixture();
    const shotId = s.fixture.shotsByTheme.get('beach-sunset')![0]!;
    const asset = unwrap(s.repos.shots.get(shotId)).assetId;
    const result = unwrap(await s.search.findSimilar(shotId, undefined, 10, true));
    expect(searchResultSchema.safeParse(result).success).toBe(true);
    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.hits.slice(0, 5).map((h) => s.themeOfShot(h.shot.id))).toEqual(
      Array(5).fill('beach-sunset'),
    );
    expect(result.hits.some((h) => h.shot.id === shotId || h.asset.id === asset)).toBe(false);
    expect(result.hits.every((h) => h.matchedBy.every((m) => m === 'visual' || m === 'description'))).toBe(
      true,
    );
    expect(s.embedder.calls).toEqual([]);
  });

  it('may return the same asset’s other shots, never the shot or its near-duplicates', async () => {
    const s = searchFixture();
    const shots = [...s.fixture.shotsByTheme.values()].flat();
    const multi = shots.find(
      (id) => s.repos.shots.listByAsset(unwrap(s.repos.shots.get(id)).assetId).length === 3,
    )!;
    const asset = unwrap(s.repos.shots.get(multi)).assetId;
    // Make a sibling look exactly like it: the nearest frame there is.
    const sibling = s.repos.shots.listByAsset(asset).find((shot) => shot.id !== multi)!;
    const frame = unwrap(s.vectors.get([`frame:${multi}:0`])).get(`frame:${multi}:0`)!;
    unwrap(
      s.vectors.upsert([
        { id: `frame:${sibling.id}:0`, vector: frame, metadata: { assetId: asset, kind: 'frame' } },
      ]),
    );
    const same = unwrap(await s.search.findSimilar(multi, undefined, 30, false)).hits;
    expect(same.map((h) => h.shot.id)).toContain(sibling.id);
    const apart = unwrap(await s.search.findSimilar(multi, undefined, 30, true)).hits;
    expect(apart.some((h) => h.asset.id === asset)).toBe(false);
    expect(same.some((h) => h.shot.id === multi)).toBe(false);

    const [pair] = s.db.driver
      .prepare(
        'SELECT id, duplicate_group AS leader FROM shots WHERE best_take = 0 AND duplicate_group IS NOT NULL',
      )
      .all() as { id: ShotId; leader: ShotId }[];
    const around = unwrap(await s.search.findSimilar(pair!.leader, { bestTakesOnly: false }, 30, true)).hits;
    expect(around.some((h) => h.shot.id === pair!.id || h.shot.id === pair!.leader)).toBe(false);
  });

  it('returns nothing for a shot without vectors and not_found for an unknown one', async () => {
    const s = searchFixture();
    const shotId = s.fixture.shotsByTheme.get('office')![0]!;
    unwrap(s.vectors.remove([`frame:${shotId}:0`, `description:${shotId}`]));
    expect(unwrap(await s.search.findSimilar(shotId, undefined, 10, true)).hits).toEqual([]);
    const unknown = await s.search.findSimilar(newId<'Shot'>(), undefined, 10, true);
    expect(!unknown.ok && unknown.error.code).toBe('core.not_found');
  });

  it('needs a vector index', async () => {
    const s = searchFixture();
    const search = createLibrarySearch({ db: s.db, vectors: null, embedder: s.embedder });
    const result = await search.findSimilar(s.fixture.shotsByTheme.get('office')![0]!, undefined, 5, true);
    expect(!result.ok && result.error.code).toBe('library.embedder_unavailable');
  });

  it('averages a shot’s frames into one direction', () => {
    const mean = meanVector([Float32Array.of(1, 0), Float32Array.of(0, 1)])!;
    expect(Array.from(mean).map((v) => v.toFixed(4))).toEqual(['0.7071', '0.7071']);
    expect(meanVector([])).toBeNull();
  });
});
