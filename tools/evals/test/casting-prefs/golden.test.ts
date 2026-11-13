// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The golden set with learned weights (LRN1-PREF): P2-Q2 acceptance and tune:casting through the real casting
 * adapter over the synthetic lavfi library, casting.v1 against weights a simulated creator taught. Synthetic.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { testFfmpegFor } from '@taalcut/media/test-support';
import { CASTING_CONFIG } from '@taalcut/timeline';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { CASTING_FIXTURE_LIBRARY, writeCastingFixtures } from '../../src/casting/fixtures';
import { loadCastingCases } from '../../src/casting/schema';
import { renderGoldenMarkdown, runGolden } from '../../src/casting-prefs/golden';
import { STARTS_PROCESSES } from '../starts-processes';

const { binaries } = testFfmpegFor(inject('testFfmpeg'), 'casting preferences golden set');
const dir = mkdtempSync(join(tmpdir(), 'taalcut-prefs-golden-'));
let written: { libraryDir: string; labelsDir: string };

beforeAll(async () => {
  if (!binaries) return;
  written = await writeCastingFixtures(dir, binaries.ffmpeg);
}, STARTS_PROCESSES.timeout);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe.skipIf(!binaries)('the golden set with learned weights (LRN1-PREF)', () => {
  it(
    'keeps P2-Q2 and tune:casting acceptance with weights an energy-first creator taught',
    async () => {
      if (!binaries) throw new Error('casting preferences golden set: no FFmpeg');
      const report = await runGolden({
        cases: loadCastingCases(written.labelsDir),
        libraries: { [CASTING_FIXTURE_LIBRARY]: written.libraryDir },
        binaries,
        weights: [
          { name: 'casting.v1', weights: CASTING_CONFIG.weights },
          {
            name: 'energy-first',
            weights: { intent: 0.331, motion: 0.148, quality: 0.144, subject: 0.155, energy: 0.222 },
          },
        ],
      });
      expect(report).toMatchObject({
        suite: 'casting-prefs-golden',
        synthetic: true,
        claimed: false,
        noWorse: true,
      });
      expect(report.rows.map((row) => row.pickAcceptance)).toEqual([1, 1]);
      expect(report.rows.map((row) => row.orderAcceptance)).toEqual([1, 1]);
      expect(report.rows[1]?.tune.holdoutPickAcceptance).toBeGreaterThanOrEqual(
        report.rows[0]?.tune.holdoutPickAcceptance ?? 1,
      );
      expect(renderGoldenMarkdown(report)).toContain('its holdout is not independent');
    },
    STARTS_PROCESSES.timeout,
  );
});
