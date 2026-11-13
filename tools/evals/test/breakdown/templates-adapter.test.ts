// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The real breakdown adapter (P2-T4 wiring): @taalcut/templates' pipeline on
 * the pixel-true fixture reels, with @taalcut/media and @taalcut/vision for
 * the probe, scene scores and frames, and stand-ins for the embedding and
 * beat models. Scored by this package's scorer. Synthetic, never gate 3.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { templateBreakdownSystem } from '../../src/adapters/breakdown';
import { buildBreakdownFixture } from '../../src/breakdown/fixtures';
import { predictBreakdown, scoreBreakdown, writeBreakdownSteps } from '../../src/breakdown/run';
import { testFfmpegFor } from '@taalcut/media/test-support';

// The run's FFmpeg, checked once before any file started (media's test-support-ffmpeg.ts).
const { binaries } = testFfmpegFor(inject('testFfmpeg'), 'templates breakdown adapter');
const dir = mkdtempSync(join(tmpdir(), 'taalcut-bd-real-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe.skipIf(!binaries)('templates breakdown adapter on the fixture reels', () => {
  it('finds every labelled cut within 2 frames, and reports per-step cuts', async () => {
    const goldenDir = join(dir, 'golden');
    await buildBreakdownFixture(goldenDir);
    const system = templateBreakdownSystem({ media: { binaries: binaries! }, baseDir: goldenDir });
    const predictions = join(dir, 'pred');
    await predictBreakdown(system, goldenDir, predictions);
    const report = scoreBreakdown(goldenDir, predictions);
    expect(report.synthetic).toBe(true);
    expect(report.gate3.claimed).toBe(false);
    expect(report.aggregate.reelCount).toBe(4);
    expect(report.aggregate.reelsMeetingBarShare).toBe(1);

    const [both, proposals, resolved] = writeBreakdownSteps(system, join(dir, 'steps'));
    // Every final cut was proposed by some method; the resolved list is what predictCuts returned.
    expect(scoreBreakdown(goldenDir, resolved!).aggregate.f1).toBe(report.aggregate.f1);
    expect(scoreBreakdown(goldenDir, proposals!).aggregate.recall).toBeGreaterThanOrEqual(
      report.aggregate.recall,
    );
    expect(scoreBreakdown(goldenDir, both!).aggregate.precision).toBeGreaterThan(0);
  }, 240_000);
});
