// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { syntheticBreakdownSystem } from '../../src/adapters/synthetic-breakdown';
import { buildBreakdownFixture } from '../../src/breakdown/fixtures';
import { predictBreakdown, scoreBreakdown } from '../../src/breakdown/run';
import { loadGoldenDir } from '../../src/evaluate';
import { bundledFfmpeg } from '../../src/ffmpeg-bin';
import { STARTS_PROCESSES } from '../starts-processes';

const bins = bundledFfmpeg();
const dir = mkdtempSync(join(tmpdir(), 'taalcut-bd-'));
const goldenDir = join(dir, 'golden');

// One encode of the four reels for both tests; each writes its own predictions.
beforeAll(async () => {
  if (bins !== undefined) await buildBreakdownFixture(goldenDir);
}, STARTS_PROCESSES.timeout);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe.skipIf(bins === undefined)('breakdown adapter wiring', () => {
  it('scores known synthetic cuts as gate 3 pass, unclaimed', async () => {
    const reels = loadGoldenDir(goldenDir);
    expect(reels).toHaveLength(4);
    const cutsByReelId = Object.fromEntries(reels.map((reel) => [reel.reelId, [...reel.cuts]]));
    const predictions = join(dir, 'pred-known');
    await predictBreakdown(syntheticBreakdownSystem(cutsByReelId), goldenDir, predictions);
    const report = scoreBreakdown(goldenDir, predictions);
    expect(report.synthetic).toBe(true);
    expect(report.gate3.pass).toBe(true);
    expect(report.gate3.claimed).toBe(false);
    expect(report.aggregate.reelsMeetingBarShare).toBe(1);
  });

  it('drops gate 3 when one of four reels is shifted by 3 frames', async () => {
    const reels = loadGoldenDir(goldenDir);
    const cutsByReelId = Object.fromEntries(
      reels.map((reel) => [
        reel.reelId,
        reel.reelId === 'bd-red' ? reel.cuts.map((cut) => cut + 3) : [...reel.cuts],
      ]),
    );
    const predictions = join(dir, 'pred-shifted');
    await predictBreakdown(syntheticBreakdownSystem(cutsByReelId), goldenDir, predictions);
    const report = scoreBreakdown(goldenDir, predictions);
    expect(report.aggregate.reelsMeetingBarShare).toBe(0.75);
    expect(report.gate3.pass).toBe(false);
    expect(report.gate3.claimed).toBe(false);
    expect(report.reels.find((reel) => reel.reelId === 'bd-red')?.meetsBar).toBe(false);
  });
});
