// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** P2-L10 degraded mode: without the embedding model, search answers from keywords and says so. */
import { err, NotImplementedError, unwrap, type Embedder } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createLibrarySearch } from '../../src/index';
import { FAKE_SPACE } from '../fixtures/fake-embedder';
import { searchFixture } from './search-helpers';

const failing: Embedder = {
  space: FAKE_SPACE,
  embedTexts: async () => err(NotImplementedError({ feature: 'embeddings' })),
};

describe('degraded search', () => {
  it.each([
    ['no embedder yet', { embedder: null }],
    ['an embedder that fails', { embedder: failing }],
  ] as const)('falls back to keywords with %s', async (_, options) => {
    const s = searchFixture(options);
    const result = unwrap(await s.search.search('sunset beach', undefined, 10));
    expect(result.degraded).toBe('keyword-only');
    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.hits.every((h) => h.matchedBy.length === 1 && h.matchedBy[0] === 'keyword')).toBe(true);
    // Scored against the keyword list alone: a top keyword rank is (nearly) a full match.
    expect(result.hits[0]!.score).toBeGreaterThan(0.95);
    expect(result.hits.slice(0, 3).map((h) => s.themeOfShot(h.shot.id))).toEqual(
      Array(3).fill('beach-sunset'),
    );
  });

  it('keeps keyword hits that hold few of the query’s terms (v2’s coverage needs other lists to weigh)', async () => {
    const s = searchFixture({ embedder: null });
    const result = unwrap(await s.search.search('sunset beach tonight', undefined, 100));
    expect(result.degraded).toBe('keyword-only');
    const themes = new Set(result.hits.map((h) => s.themeOfShot(h.shot.id)));
    expect(themes.has('beach-sunset')).toBe(true);
    expect(themes.has('beach-day')).toBe(true); // "beach" alone: 1 of 3 terms
  });

  it('falls back when there is no vector index yet', async () => {
    const s = searchFixture();
    const search = createLibrarySearch({ db: s.db, vectors: null, embedder: s.embedder });
    const result = unwrap(await search.search('mercado de verduras', undefined, 10));
    expect(result.degraded).toBe('keyword-only');
    expect(s.embedder.calls).toEqual([]);
    const similar = await search.findSimilar(result.hits[0]!.shot.id, undefined, 5, true);
    expect(!similar.ok && similar.error.code).toBe('library.embedder_unavailable');
  });

  it('is not degraded when a query simply has no keywords', async () => {
    const s = searchFixture();
    const result = unwrap(await s.search.search('!!!', undefined, 10));
    expect(result.degraded).toBeUndefined();
  });
});
