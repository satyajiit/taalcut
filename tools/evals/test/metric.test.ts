// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import { cutScores, scoreAll, scoreReel } from '../src/metric';
import { parseGoldenReel, type GoldenReel, type PredictionReel } from '../src/schema';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const goldenDir = join(dirname(fileURLToPath(import.meta.url)), '../golden/sample');

function load(name: string): GoldenReel {
  return parseGoldenReel(JSON.parse(readFileSync(join(goldenDir, name), 'utf8')) as unknown);
}

function prediction(reelId: string, cuts: number[]): PredictionReel {
  return { reelId, cuts };
}

describe('cutScores', () => {
  it('scores an empty reel as perfect and still on the bar', () => {
    expect(cutScores(0, 0, 0)).toMatchObject({
      precision: 1,
      recall: 1,
      f1: 1,
      withinToleranceShare: 1,
      meetsBar: true,
    });
  });

  it('gives precision 1 when nothing was predicted, and recall 1 when nothing was true', () => {
    expect(cutScores(0, 0, 3)).toMatchObject({ precision: 1, recall: 0, f1: 0, meetsBar: false });
    expect(cutScores(0, 4, 0)).toMatchObject({
      precision: 0,
      recall: 1,
      f1: 0,
      withinToleranceShare: 1,
      meetsBar: true,
    });
  });

  it('uses micro counts for the aggregate and the reel bar for the share', () => {
    const english = load('sample-en-30.json');
    const hindi = load('sample-hi-2997.json');
    const report = scoreAll([
      { reel: english, prediction: prediction(english.reelId, [24]) },
      { reel: hindi, prediction: prediction(hindi.reelId, []) },
    ]);
    expect(report.aggregate.tp).toBe(1);
    expect(report.aggregate.fp).toBe(0);
    expect(report.aggregate.fn).toBe(english.cuts.length + hindi.cuts.length - 1);
    expect(report.aggregate.reelsMeetingBar).toBe(0);
    expect(report.aggregate.reelCount).toBe(2);
    expect(report.reels[0]?.meetsBar).toBe(false);
    expect(report.reels[1]?.withinToleranceShare).toBe(0);
  });
});

describe('scoreReel', () => {
  it('refuses a prediction for a different reel', () => {
    const reel = load('sample-es-25.json');
    expect(() => scoreReel(reel, prediction('sample-en-30', reel.cuts))).toThrow(/does not match/);
  });
});
