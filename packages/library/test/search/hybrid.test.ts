// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** P2-L10 hybrid search: fusion order on the seeded fake embedder, over the 200-asset fixture library. */
import { newId, searchResultSchema, unwrap, type ShotId, type VectorIndex } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createLibrarySearch, fuse, SEARCH_FUSION_V1 } from '../../src/index';
import { LANGUAGES, THEMES } from '../fixtures/library-themes';
import { searchFixture } from './search-helpers';

const id = () => newId<'Shot'>() as ShotId;

describe('fuse (weighted reciprocal rank, k = 60)', () => {
  it('adds w / (60 + rank) per list and scores against the most a shot could get', () => {
    const [a, b, c] = [id(), id(), id()];
    const at = (shotId: ShotId) => ({ shotId, similarity: 0.5 });
    const fused = fuse({ frame: [at(a), at(b)], keyword: [at(b), at(c), at(b)] }, SEARCH_FUSION_V1);
    const max = (1.0 + 0.9 + 0.7 + 0.6 + 0.8) / 61;
    const value = (shot: ShotId) => fused.find((f) => f.shotId === shot)!.score * max;
    expect(value(a)).toBeCloseTo(1.0 / 61);
    expect(value(b)).toBeCloseTo(1.0 / 62 + 0.8 / 61); // a repeat in one list counts once, at its best rank
    expect(value(c)).toBeCloseTo(0.8 / 62);
    expect(fused.map((f) => f.shotId)).toEqual([b, a, c]);
    expect(fused[0]!.matchedBy).toEqual(['frame', 'keyword']);
    // Keyword-only (degraded) scores against the keyword list alone.
    expect(fuse({ keyword: [at(c)] }, SEARCH_FUSION_V1, ['keyword'])[0]!.score).toBe(1);
  });
});

describe('library search over the fixture library', () => {
  it('finds sunset shots on the beach first, in all four languages', async () => {
    const s = searchFixture();
    const theme = THEMES.find((t) => t.key === 'beach-sunset')!;
    for (const language of LANGUAGES) {
      const result = unwrap(await s.search.search(theme.queries[language], undefined, 12));
      expect(searchResultSchema.safeParse(result).success).toBe(true);
      expect(result.degraded).toBeUndefined();
      const top = result.hits.slice(0, 5).map((h) => s.themeOfShot(h.shot.id));
      expect(top, `${language}: ${theme.queries[language]}`).toEqual(Array(5).fill('beach-sunset'));
      const scores = result.hits.map((h) => h.score);
      expect(scores).toEqual([...scores].sort((x, y) => y - x));
      expect(scores[0]!).toBeLessThanOrEqual(1);
      expect(scores.every((x) => x >= scores[0]! * 0.25)).toBe(true);
      expect(result.hits[0]!.matchedBy).toContain('visual');
    }
  });

  it('says why each hit matched and highlights the keyword passage', async () => {
    const s = searchFixture();
    const result = unwrap(await s.search.search('सूर्यास्त', undefined, 30));
    const spoken = result.hits.find(
      (h) => h.matchedBy.includes('keyword') && h.snippet?.field === 'transcript',
    );
    expect(spoken).toBeDefined();
    const { text, highlights } = spoken!.snippet!;
    expect(highlights.map(([a, b]) => text.slice(a, b))).toContain('सूर्यास्त');
    expect(text).not.toMatch(/[<>]/);
    expect(result.hits.some((h) => h.matchedBy.includes('speech'))).toBe(true);
  });

  it('embeds each query once and remembers recent ones', async () => {
    const s = searchFixture();
    unwrap(await s.search.search('dog running in the park', undefined, 5));
    unwrap(await s.search.search('dog running in the park', undefined, 5));
    unwrap(await s.search.search('vegetable market', undefined, 5));
    expect(s.embedder.calls).toEqual([['dog running in the park'], ['vegetable market']]);
  });

  it('keeps at most three shots per asset and returns no more than asked', async () => {
    const s = searchFixture();
    const result = unwrap(await s.search.search('Golden sunset over the beach', undefined, 100));
    const perAsset = new Map<string, number>();
    for (const hit of result.hits) perAsset.set(hit.asset.id, (perAsset.get(hit.asset.id) ?? 0) + 1);
    expect(Math.max(...perAsset.values())).toBeLessThanOrEqual(3);
    expect(unwrap(await s.search.search('sunset', undefined, 4)).hits).toHaveLength(4);
  });

  it('widens the kNN once when filters leave fewer hits than asked', async () => {
    const s = searchFixture();
    const ks: number[] = [];
    const spy: VectorIndex = {
      ...s.vectors,
      search: (query, options) => {
        ks.push(options.k);
        return s.vectors.search(query, options);
      },
    };
    const search = createLibrarySearch({
      db: s.db,
      vectors: spy,
      embedder: s.embedder,
      fusion: { ...SEARCH_FUSION_V1, knn: 50 },
    });
    const result = unwrap(await search.search('sunset', { kinds: ['image'] }, 30));
    expect(ks).toEqual([50, 200]);
    expect(result.hits.every((h) => h.asset.kind === 'image')).toBe(true);
    ks.length = 0;
    unwrap(await search.search('sunset', undefined, 5));
    expect(ks).toEqual([50]);
  });
});
