// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FIXTURE_FROM, FIXTURE_TO, writeGateFixtures, type FixtureCase } from '../../src/gates/fixtures';
import { loadGateInputs, type GatePaths } from '../../src/gates/inputs/load';
import { buildReport, type GateReport } from '../../src/gates/report/build';
import { type GateId } from '../../src/gates/gate-metric';

/** The real-input path: `pass` and `fail` are written unmarked; the `synthetic` case is always marked. */
export function writtenFixture(fixtureCase: FixtureCase): string {
  const root = mkdtempSync(join(tmpdir(), `taalcut-gates-${fixtureCase}-`));
  writeGateFixtures(root, fixtureCase, false);
  return root;
}

/** Optional paths listed in `omit` stay absent. A present path that cannot be read still throws. */
export function reportFor(root: string, gate: GateId, omit: readonly string[] = []): GateReport {
  const paths: GatePaths = { gate, from: FIXTURE_FROM, to: FIXTURE_TO };
  const optional: [keyof GatePaths, string][] = [
    ['telemetry', join(root, 'telemetry')],
    ['evals', join(root, 'evals')],
    ['sessions', join(root, 'sessions')],
    ['crashes', join(root, 'crashes.json')],
    ['ci', join(root, 'ci')],
    ['manual', join(root, 'manual.json')],
    ['cohorts', join(root, 'cohorts.json')],
  ];
  for (const [key, path] of optional) {
    if (!omit.includes(key)) paths[key] = path;
  }
  return buildReport(loadGateInputs(paths));
}
