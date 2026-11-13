// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The fit bench at a small size: the app's library, template index and fitter run end to end, and the pool fills
 * the templates it was drawn for. The timing itself is measured with `bench:template-fit` on a reference Mac.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runFitBench } from '../../src/template-fit/bench';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('the fit bench', () => {
  it('fits every template against the whole pool and reports the timings', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'taalcut-fit-bench-'));
    dirs.push(dir);
    const result = await runFitBench({ templates: 6, shots: 40, runs: 2, dir });
    expect(result).toMatchObject({ templates: 6, shots: 40, poolShots: 40, runs: 2, bestCoverage: 1 });
    expect(result.medianMs).toBeGreaterThan(0);
    expect(result.maxMs).toBeGreaterThanOrEqual(result.medianMs);
  });
});
