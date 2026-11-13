// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The P2-Q1 eval hook on the fixture's 40 synthetic queries (10 themes × en, hi, es, pt-BR). These
 * numbers are not gate criterion 11: that needs the human labels on the real sample libraries.
 */
import { err, NotImplementedError, ok } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { evaluateSearch, type LibrarySearchPort } from '../../src/index';
import { searchFixture } from './search-helpers';

describe('evaluateSearch', () => {
  it('scores top-5 relevance per query and per language', async () => {
    const s = searchFixture();
    const report = await evaluateSearch(s.search, s.fixture.queries, { k: 5 });
    const languages = Object.entries(report.byLanguage)
      .map(([language, r]) => `${language} ${r.hits}/${r.queries}`)
      .join(', ');
    process.stdout.write(
      `[search eval, synthetic] top-5 hit rate ${(report.hitRate * 100).toFixed(1)}% (${languages})\n`,
    );
    expect(report.queries).toHaveLength(40);
    expect(Object.keys(report.byLanguage).sort()).toEqual(['en', 'es', 'hi', 'pt-BR']);
    expect(report.errors).toEqual([]);
    // A regression guard on the synthetic set, at the gate's bar.
    for (const score of Object.values(report.byLanguage)) expect(score.hitRate).toBeGreaterThanOrEqual(0.75);
    expect(report.queries.every((q) => q.topShotIds.length <= 5 && !q.degraded)).toBe(true);
  });

  it('counts relevant assets, misses and failed queries', async () => {
    const search: Pick<LibrarySearchPort, 'search'> = {
      search: async (query) =>
        query === 'boom'
          ? err(NotImplementedError({ feature: 'x' }))
          : ok({ hits: [{ shot: { id: 's2', assetId: 'a1' } }] as never, tookMs: 3 }),
    };
    const report = await evaluateSearch(search, [
      { query: 'one', language: 'en', relevant: ['s1'], relevantAssets: ['a1'] },
      { query: 'two', language: 'en', relevant: ['s9'] },
      { query: 'boom', language: 'hi', relevant: ['s2'] },
    ]);
    expect(report.queries.map((q) => [q.hit, q.firstRelevantRank])).toEqual([
      [true, 1],
      [false, null],
      [false, null],
    ]);
    expect(report.byLanguage).toEqual({
      en: { queries: 2, hits: 1, hitRate: 0.5 },
      hi: { queries: 1, hits: 0, hitRate: 0 },
    });
    expect(report.errors).toEqual([{ query: 'boom', code: 'core.not_implemented' }]);
  });
});
