// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The template search suite (LRN1-TPL): hit@5, reciprocal rank and nDCG@5 on hand-made rankings, and the synthetic
 * set end to end through the library's TemplateSearch with the deterministic embedder, scored as a synthetic,
 * unclaimed report.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { hashingEmbedder } from '../../src/casting/library';
import { writeTemplateSearchFixtures } from '../../src/template-search/fixtures';
import { ndcgAt5, scoreTemplateQuery } from '../../src/template-search/metric';
import { predictTemplateSearch, scoreTemplateSearchDirs } from '../../src/template-search/run';
import { loadTemplateQueries, type TemplateQuery } from '../../src/template-search/schema';
import { templateSearchSystem } from '../../src/template-search/system';

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const query: TemplateQuery = {
  queryId: 'q',
  library: 'lib',
  synthetic: false,
  text: 'beach',
  kind: 'words',
  relevant: ['a', 'b'],
};

describe('template search metric', () => {
  it('scores a ranking by its first right template and the right ones in the top 5', () => {
    const score = scoreTemplateQuery(query, {
      queryId: 'q',
      library: 'lib',
      results: ['x', 'a', 'y', 'z', 'w', 'b'],
      degraded: null,
      fusion: 'f',
      space: 's',
    });
    expect(score).toMatchObject({ hitAt5: 1, reciprocalRank: 0.5, degraded: false });
    expect(score.ndcgAt5).toBeCloseTo(1 / Math.log2(3) / (1 + 1 / Math.log2(3)), 12);
  });

  it('is zero without a prediction, and nDCG is 1 for a perfect list', () => {
    expect(scoreTemplateQuery(query, undefined)).toMatchObject({ hitAt5: 0, reciprocalRank: 0, ndcgAt5: 0 });
    expect(ndcgAt5(new Set(['a', 'b']), ['a', 'b', 'c'])).toBe(1);
  });
});

describe('the synthetic template search set', () => {
  it('finds a right template in the top 5 for every query, as an unclaimed synthetic report', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'taalcut-template-search-'));
    dirs.push(dir);
    const written = writeTemplateSearchFixtures(dir);
    const system = templateSearchSystem({
      libraries: { 'synthetic-templates': written.libraryDir },
      embedder: hashingEmbedder(),
      workDir: join(dir, 'work'),
    });
    try {
      await predictTemplateSearch(system, loadTemplateQueries(written.labelsDir), join(dir, 'predictions'));
    } finally {
      await system.close();
    }
    const report = scoreTemplateSearchDirs(written.labelsDir, join(dir, 'predictions'));
    expect(report).toMatchObject({ suite: 'template-search', synthetic: true, claimed: false, degraded: 0 });
    expect(report.fusions).toEqual(['template-search-v1']);
    expect(report.scores.rows[0]).toMatchObject({ kind: 'overall', queries: 14, hitAt5: 1 });
  });
});
