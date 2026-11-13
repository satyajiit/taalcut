// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The template fit suite (LRN1-TPL): the metric on hand-made rankings, and the synthetic set end to end with the
 * real fitter (lavfi clips probed with the run's ffprobe, the library's template store and index), scored as a
 * synthetic, unclaimed report.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { testFfmpegFor } from '@taalcut/media/test-support';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { writeFitFixtures } from '../../src/template-fit/fixtures';
import { ALTERNATIVE_ORDERS, fitGatePasses, reranked, scoreFitCases } from '../../src/template-fit/metric';
import { predictFit, scoreFitDirs } from '../../src/template-fit/run';
import { loadFitCases, type FitCase, type FitPrediction } from '../../src/template-fit/schema';
import { timelineFitSystem } from '../../src/template-fit/system';
import { STARTS_PROCESSES } from '../starts-processes';

const { binaries } = testFfmpegFor(inject('testFfmpeg'), 'template fit suite');
const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const fitCase = (caseId: string, best: string): FitCase => ({
  caseId,
  library: 'lib',
  synthetic: false,
  pool: ['clips/a.mkv'],
  best,
});

const prediction = (caseId: string, ranking: readonly string[]): FitPrediction => ({
  caseId,
  library: 'lib',
  poolShots: 1,
  ranking: ranking.map((template) => ({ template, slots: 4, covered: 4, coverage: 1, meanScore: 0.5 })),
});

describe('template fit metric', () => {
  it('counts the right template at 1, in the top 3, and its reciprocal rank', () => {
    const cases = [fitCase('one', 'a'), fitCase('three', 'a'), fitCase('five', 'a'), fitCase('none', 'a')];
    const predictions = new Map(
      [
        prediction('one', ['a', 'b']),
        prediction('three', ['b', 'c', 'a']),
        prediction('five', ['b', 'c', 'd', 'e', 'a']),
        prediction('none', ['b']),
      ].map((row) => [`lib/${row.caseId}`, row]),
    );
    const scores = scoreFitCases(cases, predictions);
    expect(scores.cases.map((row) => row.rank)).toEqual([1, 3, 5, null]);
    expect(scores.top1).toBe(0.25);
    expect(scores.top3).toBe(0.5);
    expect(scores.meanReciprocalRank).toBeCloseTo((1 + 1 / 3 + 1 / 5) / 4, 12);
    expect(fitGatePasses(scores)).toBe(false);
  });

  it('re-ranks the same predictions complete first and by match alone', () => {
    const row = (template: string, slots: number, covered: number, meanScore: number | null) => ({
      template,
      slots,
      covered,
      coverage: covered / slots,
      meanScore,
    });
    // The fitter's order (fit score): closer 0.8 × 3/4 = 0.6, quick 0.5, none last.
    const fitted: FitPrediction = {
      caseId: 'short',
      library: 'lib',
      poolShots: 3,
      ranking: [row('closer', 4, 3, 0.8), row('quick', 3, 3, 0.5), row('none', 2, 0, null)],
    };
    const orders = Object.fromEntries(
      Object.entries(ALTERNATIVE_ORDERS).map(([name, order]) => [
        name,
        reranked(new Map([['lib/short', fitted]]), order)
          .get('lib/short')
          ?.ranking.map((r) => r.template),
      ]),
    );
    expect(orders).toEqual({
      'complete first': ['quick', 'closer', 'none'],
      'match alone': ['closer', 'quick', 'none'],
    });
  });

  it('fails the bar when a set has no prediction, even if the rest are right', () => {
    const cases = [fitCase('one', 'a'), fitCase('two', 'a')];
    const scores = scoreFitCases(cases, new Map([['lib/one', prediction('one', ['a'])]]));
    expect(scores.missing).toEqual(['lib/two']);
    expect(fitGatePasses(scores)).toBe(false);
  });
});

describe.skipIf(!binaries)('the synthetic template fit set', STARTS_PROCESSES, () => {
  it("ranks each footage set's labelled template first, as an unclaimed synthetic report", async () => {
    if (!binaries) throw new Error('template fit suite: no FFmpeg');
    const dir = mkdtempSync(join(tmpdir(), 'taalcut-fit-eval-'));
    dirs.push(dir);
    const written = await writeFitFixtures(dir, binaries.ffmpeg);
    const cases = loadFitCases(written.labelsDir);
    const system = timelineFitSystem({
      libraries: { 'synthetic-fit': written.libraryDir },
      binaries,
      workDir: join(dir, 'work'),
    });
    try {
      await predictFit(system, cases, join(dir, 'predictions'));
    } finally {
      await system.close();
    }
    const report = scoreFitDirs(written.labelsDir, join(dir, 'predictions'));
    expect(report).toMatchObject({ suite: 'template-fit', synthetic: true, claimed: false });
    expect(report.scores.cases).toHaveLength(9);
    expect(report.scores.top3).toBeGreaterThanOrEqual(0.8);
    expect(report.scores.top1).toBe(1);
    // Each other order misses one of the two short sets.
    expect(report.alternatives.map((row) => [row.order, row.top1])).toEqual([
      ['complete first', 8 / 9],
      ['match alone', 8 / 9],
    ]);
  });
});
