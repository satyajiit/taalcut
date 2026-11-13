// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { syntheticSearchSystem } from '../../src/adapters/synthetic-search';
import { queriesFromSearchCsv, writeSearchLabels } from '../../src/search/csv';
import { ndcgAt5, scoreQuery } from '../../src/search/metric';
import { scoreSearch } from '../../src/search/run';
import { loadSearchLabels, type SearchPrediction, type SearchQueryLabel } from '../../src/search/schema';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function query(overrides: Partial<SearchQueryLabel> = {}): SearchQueryLabel {
  return {
    queryId: 'en-beach',
    language: 'en',
    library: 'lib',
    text: 'beach',
    relevant: [{ asset: 'clips/a.mkv', range: { startFrame: 0, endFrame: 10 } }],
    synthetic: true,
    ...overrides,
  };
}

function prediction(results: SearchPrediction['results'], queryId = 'en-beach'): SearchPrediction {
  return { queryId, results };
}

describe('search metrics', () => {
  it('computes hit@5, precision@5, reciprocal rank and nDCG@5', () => {
    const labelled = query({
      relevant: [
        { asset: 'clips/a.mkv', range: { startFrame: 0, endFrame: 10 } },
        { asset: 'clips/b.mkv', range: { startFrame: 0, endFrame: 10 } },
      ],
    });
    const row = scoreQuery(
      labelled,
      prediction([
        { asset: 'clips/a.mkv', range: { startFrame: 0, endFrame: 10 } },
        { asset: 'clips/miss.mkv', range: { startFrame: 0, endFrame: 10 } },
        { asset: 'clips/b.mkv', range: { startFrame: 0, endFrame: 10 } },
        { asset: 'clips/miss.mkv', range: { startFrame: 10, endFrame: 20 } },
        { asset: 'clips/miss.mkv', range: { startFrame: 20, endFrame: 30 } },
      ]),
    );
    expect(row.hitAt5).toBe(1);
    expect(row.precisionAt5).toBe(0.4);
    expect(row.reciprocalRank).toBe(1);
    expect(row.ndcgAt5).toBeCloseTo(1.5 / (1 + 1 / Math.log2(3)), 10);
    expect(ndcgAt5(labelled.relevant, [])).toBe(0);
  });

  it('uses min(5, results) as the precision denominator', () => {
    const row = scoreQuery(query(), prediction([{ asset: 'clips/a.mkv', range: { startFrame: 0, endFrame: 10 } }]));
    expect(row.precisionAt5).toBe(1);
    expect(row.hitAt5).toBe(1);
  });

  it('scores an empty list as a miss and keeps reciprocal rank past the top 5', () => {
    expect(scoreQuery(query(), prediction([])).precisionAt5).toBe(0);
    expect(scoreQuery(query(), prediction([])).hitAt5).toBe(0);
    const late = scoreQuery(
      query(),
      prediction([
        { asset: 'clips/m.mkv', range: { startFrame: 0, endFrame: 1 } },
        { asset: 'clips/m.mkv', range: { startFrame: 1, endFrame: 2 } },
        { asset: 'clips/m.mkv', range: { startFrame: 2, endFrame: 3 } },
        { asset: 'clips/m.mkv', range: { startFrame: 3, endFrame: 4 } },
        { asset: 'clips/m.mkv', range: { startFrame: 4, endFrame: 5 } },
        { asset: 'clips/a.mkv', range: { startFrame: 0, endFrame: 10 } },
      ]),
    );
    expect(late.hitAt5).toBe(0);
    expect(late.precisionAt5).toBe(0);
    expect(late.reciprocalRank).toBeCloseTo(1 / 6);
    expect(late.ndcgAt5).toBe(0);
  });

  it('counts an overlap of exactly half the shorter range', () => {
    const hit = scoreQuery(
      query(),
      prediction([{ asset: 'clips/a.mkv', range: { startFrame: 5, endFrame: 15 } }]),
    );
    expect(hit.hitAt5).toBe(1);
    const miss = scoreQuery(
      query(),
      prediction([{ asset: 'clips/a.mkv', range: { startFrame: 6, endFrame: 16 } }]),
    );
    expect(miss.hitAt5).toBe(0);
  });
});

describe('search gate', () => {
  function one(language: SearchQueryLabel['language']): SearchQueryLabel {
    return query({
      queryId: `${language}-q`,
      language,
      relevant: [{ asset: `${language}.mkv` }],
    });
  }

  function predicted(queries: SearchQueryLabel[], missLanguage?: SearchQueryLabel['language']): Map<string, SearchPrediction> {
    return new Map(
      queries.map((item) => [
        item.queryId,
        prediction(
          item.language === missLanguage
            ? [{ asset: 'nope.mkv', range: { startFrame: 0, endFrame: 1 } }]
            : [{ asset: `${item.language}.mkv`, range: { startFrame: 0, endFrame: 1 } }],
          item.queryId,
        ),
      ]),
    );
  }

  it('passes at 1.0 in every language and does not claim a synthetic set', () => {
    const queries = [one('en'), one('hi'), one('es'), one('pt-BR')];
    const report = scoreSearch(queries, predicted(queries));
    expect(report.gate.pass).toBe(true);
    expect(report.claimed).toBe(false);
    expect(report.synthetic).toBe(true);
    expect(report.languages.find((row) => row.language === 'pt-BR')?.hitAt5).toBe(1);
    expect(report.metrics.map((metric) => metric.name)).toEqual(['hitAt5', 'precisionAt5', 'reciprocalRank', 'ndcgAt5']);
  });

  it('fails when one language is under 0.75 or missing', () => {
    const queries = [one('en'), one('hi'), one('es'), one('pt-BR')];
    expect(scoreSearch(queries, predicted(queries, 'hi')).gate.pass).toBe(false);
    expect(scoreSearch(queries.filter((item) => item.language !== 'es'), predicted(queries)).gate.pass).toBe(false);
  });
});

describe('synthetic search system', () => {
  it('drops a clip that fails minFrames and matches a whole word only', () => {
    const system = syntheticSearchSystem([
      { asset: 'clips/a.mkv', word: 'market', frames: 5, orientation: 'landscape', quality: 0.9, captured: '2026-01-15' },
      { asset: 'clips/b.mkv', word: 'marketplace', frames: 40, orientation: 'landscape', quality: 0.9, captured: '2026-01-15' },
    ]);
    return system
      .search(
        { queryId: 'q', language: 'en', library: 'lib', text: 'the market stall', filters: { minFrames: 10 } },
        5,
      )
      .then((hits) => expect(hits).toEqual([]));
  });
});

describe('search csv', () => {
  it('groups rows into one file per library and keeps a whole-asset shot', () => {
    const csv = [
      'queryId,language,library,text,asset,startFrame,endFrame,synthetic',
      'en-market,en,lib-a,the market,clips/a.mkv,0,5,true',
      'en-market,en,lib-a,the market,clips/b.mkv,,,true',
      'hi-bazaar,hi,lib-b,bazaar,clips/c.mkv,1,4,false',
    ].join('\n');
    const queries = queriesFromSearchCsv(csv);
    expect(queries[0]?.relevant).toEqual([
      { asset: 'clips/a.mkv', range: { startFrame: 0, endFrame: 5 } },
      { asset: 'clips/b.mkv' },
    ]);
    const dir = mkdtempSync(join(tmpdir(), 'taalcut-search-csv-'));
    dirs.push(dir);
    writeSearchLabels(queries, dir);
    const loaded = loadSearchLabels(dir);
    expect(loaded).toHaveLength(2);
    expect(readFileSync(join(dir, 'lib-a.json'), 'utf8')).toContain('en-market');
  });
});
