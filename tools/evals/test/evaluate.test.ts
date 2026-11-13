// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { main } from '../src/cli';
import { loadGoldenDir } from '../src/evaluate';
import { jsonPathFor } from '../src/report';
import { stubPrediction } from '../src/stub';

const goldenDir = join(dirname(fileURLToPath(import.meta.url)), '../golden/sample');
const predictionsDir = join(dirname(fileURLToPath(import.meta.url)), '../predictions/stub');

describe('stub breakdown', () => {
  it('places most cuts within 2 frames, one miss on the longer reels, and one extra', () => {
    const reels = loadGoldenDir(goldenDir);
    const byId = Object.fromEntries(reels.map((reel) => [reel.reelId, stubPrediction(reel).cuts]));
    expect(byId['sample-en-30']).toEqual([0, 24, 51, 80, 114, 144, 178, 208, 242, 264, 290]);
    expect(byId['sample-hi-2997']).toEqual([0, 90, 243, 480, 722]);
    expect(byId['sample-es-25']).toEqual([0, 50, 152]);
    for (const reel of reels) {
      expect(JSON.parse(readFileSync(join(predictionsDir, `${reel.reelId}.json`), 'utf8'))).toEqual(
        stubPrediction(reel),
      );
    }
  });
});

describe('eval cli', () => {
  it('writes a markdown report and a sibling json report', async () => {
    const out = join(mkdtempSync(join(tmpdir(), 'taalcut-eval-')), 'report.md');
    const code = await main(['--golden', goldenDir, '--predictions', predictionsDir, '--out', out]);
    expect(code).toBe(0);
    const markdown = readFileSync(out, 'utf8');
    expect(markdown).toContain('# Breakdown cut accuracy');
    expect(markdown).toContain('sample-hi-2997');
    expect(markdown).toContain('30000/1001');
    expect(markdown).toContain('2/3');
    const json = JSON.parse(readFileSync(jsonPathFor(out), 'utf8')) as {
      aggregate: {
        tp: number;
        fp: number;
        fn: number;
        precision: number;
        recall: number;
        f1: number;
        reelsMeetingBar: number;
      };
      reels: { reelId: string; meetsBar: boolean; recall: number }[];
    };
    expect(json.aggregate.tp).toBe(14);
    expect(json.aggregate.fp).toBe(5);
    expect(json.aggregate.fn).toBe(2);
    expect(json.aggregate.precision).toBe(14 / 19);
    expect(json.aggregate.recall).toBe(14 / 16);
    expect(json.aggregate.f1).toBeCloseTo(0.8);
    expect(json.aggregate.reelsMeetingBar).toBe(2);
    expect(json.reels.find((reel) => reel.reelId === 'sample-en-30')?.meetsBar).toBe(true);
    expect(json.reels.find((reel) => reel.reelId === 'sample-hi-2997')?.recall).toBe(0.75);
    expect(json.reels.find((reel) => reel.reelId === 'sample-es-25')?.meetsBar).toBe(true);
  });

  it('fails with a readable message when a prediction file is missing', async () => {
    const out = join(mkdtempSync(join(tmpdir(), 'taalcut-eval-')), 'report.md');
    const empty = mkdtempSync(join(tmpdir(), 'taalcut-pred-'));
    const errors: unknown[][] = [];
    const previous = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };
    try {
      const code = await main(['--golden', goldenDir, '--predictions', empty, '--out', out]);
      expect(code).toBe(1);
    } finally {
      console.error = previous;
    }
    expect(errors.join('\n')).toMatch(/No prediction for reel sample-en-30/);
  });
});
