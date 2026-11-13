// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newId } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { writeJson, writeText } from '../../src/files';
import {
  COHORT_CODE,
  DAY_MS,
  exportCompleted,
  FIXTURE_FROM,
  FIXTURE_TO,
  writeCohortFile,
  writeTelemetry,
} from '../../src/gates/fixtures';
import { loadGateInputs } from '../../src/gates/inputs/load';
import { buildReport } from '../../src/gates/report/build';
import { findCell } from './cell';

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'taalcut-gates-tiers-'));
}

function telemetryReport(root: string) {
  writeCohortFile(join(root, 'cohorts.json'));
  return buildReport(
    loadGateInputs({
      gate: 'v1',
      from: FIXTURE_FROM,
      to: FIXTURE_TO,
      cohorts: join(root, 'cohorts.json'),
      telemetry: join(root, 'telemetry'),
    }),
  );
}

describe('performance tiers, retention censoring and crash markers', () => {
  it('judges render on the 8 GB runner and indexing on the 16 GB runner only', () => {
    const root = tempDir();
    const line = (runner: string, memoryGb: number, metric: string, unit: string, value: number) =>
      JSON.stringify({
        v: 1,
        suite: 'perf',
        metric,
        unit,
        value,
        better: metric === 'preview-fps' ? 'higher' : 'lower',
        runner: { id: runner, chip: 'M1', memoryGb, macos: '15' },
        commit: 'fixture',
        date: '2027-01-20',
        synthetic: false,
        footage: 'device-lab',
        build: { flavour: 'beta', version: '0.9.0' },
      });
    // The 8 GB runner indexes slowly, which the plan allows; there is no 16 GB runner yet.
    writeText(
      join(root, 'ci', 'nightly.jsonl'),
      [
        line('m1-8gb', 8, 'cold-start', 'seconds', 2),
        line('m1-8gb', 8, 'render-60s', 'seconds', 55),
        line('m1-8gb', 8, 'index-1h', 'minutes', 45),
        line('m1-8gb', 8, 'preview-fps', 'fps', 30),
      ].join('\n'),
    );
    const built = buildReport(
      loadGateInputs({ gate: 'v1', from: FIXTURE_FROM, to: FIXTURE_TO, ci: join(root, 'ci') }),
    );
    expect(findCell(built, { metricId: 'performance', runner: 'm1-8gb' }).verdict).toBe('pass');
    const row = findCell(built, { metricId: 'performance' });
    expect(row.verdict).toBe('missing input');
    expect(row.display).toBe('no data');
    expect(row.detail).toContain('index-1h absent on a 16 GB runner');
  });

  it('does not count an install as lost before its day 28 has passed', () => {
    const root = tempDir();
    const seed = {
      installId: newId<'Install'>(),
      sessionId: newId<'TelemetrySession'>(),
      cohort: COHORT_CODE.alpha,
    };
    const lastWeek = Date.parse(`${FIXTURE_TO}T00:00:00.000Z`) - 7 * DAY_MS;
    writeTelemetry(join(root, 'telemetry'), [
      exportCompleted(
        { ...seed, at: lastWeek, seq: 0 },
        { firstExport: true, slots: 1, kept: 1, orderChanged: false },
      ),
    ]);
    const cell = findCell(telemetryReport(root), { metricId: 'retentionWeek4', cohort: 'alpha' });
    expect(cell.n).toBe(0);
    expect(cell.verdict).toBe('missing input');
  });

  it('carries a synthetic crash file into the crash-free cells', () => {
    const root = tempDir();
    writeJson(join(root, 'crashes.json'), {
      synthetic: true,
      rows: [{ release: '1.0.0', channel: 'beta', sessions: 100, crashedSessions: 0 }],
    });
    const built = buildReport(
      loadGateInputs({
        gate: 'beta',
        from: FIXTURE_FROM,
        to: FIXTURE_TO,
        crashes: join(root, 'crashes.json'),
      }),
    );
    expect(findCell(built, { metricId: 'crashFree' }).synthetic).toBe(true);
    expect(built.synthetic).toBe(true);
  });
});
