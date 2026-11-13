// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_CASTING_WEIGHTS, syntheticCastingSystem } from '../../src/adapters/synthetic-casting';
import { writeCastingFixtures } from '../../src/casting/fixtures';
import { predictCasting, scoreCastingDirs } from '../../src/casting/run';
import { loadCastingCases } from '../../src/casting/schema';
import { bundledFfmpeg } from '../../src/ffmpeg-bin';
import { STARTS_PROCESSES } from '../starts-processes';

const bins = bundledFfmpeg();
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// One FFmpeg run writes the library.
describe.skipIf(bins === undefined)('casting fixtures', STARTS_PROCESSES, () => {
  it('builds a lavfi library and scores the synthetic adapter', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'taalcut-cast-fx-'));
    dirs.push(dir);
    const ffmpeg = bins?.ffmpeg;
    if (ffmpeg === undefined) throw new Error('ffmpeg is not available');
    const written = await writeCastingFixtures(dir, ffmpeg);
    expect(existsSync(join(written.libraryDir, 'clips', 'arrival.mkv'))).toBe(true);
    expect(existsSync(join(written.libraryDir, 'clips', 'beach.mkv'))).toBe(true);
    expect(existsSync(join(written.libraryDir, 'clips', 'step.mkv'))).toBe(true);
    const cases = loadCastingCases(written.labelsDir);
    const predictions = await predictCasting(
      syntheticCastingSystem(cases),
      cases,
      DEFAULT_CASTING_WEIGHTS,
      join(dir, 'predictions'),
    );
    const report = scoreCastingDirs(written.labelsDir, join(dir, 'predictions'));
    expect(predictions).toHaveLength(1);
    expect(report.synthetic).toBe(true);
    expect(report.claimed).toBe(false);
    expect(report.gate.pass).toBe(true);
    expect(report.scores.pickAcceptance).toBe(1);
    expect(report.scores.orderAcceptance).toBe(1);
    expect(report.scores.variantDiversity).toBe(1);
  });
});
