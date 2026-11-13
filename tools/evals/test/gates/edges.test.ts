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
  feedbackSent,
  FIXTURE_FROM,
  FIXTURE_TO,
  MINUTE_MS,
  onboardingFirstExport,
  onboardingStep,
  sessionStarted,
  T0,
  writeCohortFile,
  writeTelemetry,
} from '../../src/gates/fixtures';
import { loadGateInputs } from '../../src/gates/inputs/load';
import { buildReport, type GateReport } from '../../src/gates/report/build';
import { type GateId } from '../../src/gates/gate-metric';
import { buildFixtureSession } from '../../src/usability/fixtures';
import { findCell } from './cell';

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'taalcut-gates-edge-'));
}

function report(root: string, gate: GateId, telemetry: boolean, sessions = false): GateReport {
  writeCohortFile(join(root, 'cohorts.json'));
  return buildReport(
    loadGateInputs({
      gate,
      from: FIXTURE_FROM,
      to: FIXTURE_TO,
      cohorts: join(root, 'cohorts.json'),
      ...(telemetry ? { telemetry: join(root, 'telemetry') } : {}),
      ...(sessions ? { sessions: join(root, 'sessions') } : {}),
    }),
  );
}

/** Moderated sessions; null is a participant who never exported. Written unmarked, as a real record would be. */
function writeSessions(root: string, seconds: readonly (number | null)[]): void {
  seconds.forEach((value, index) => {
    const session = buildFixtureSession({
      sessionId: `session-${index + 1}`,
      language: 'en',
      timeToFirstVideoSeconds: value,
      cohortCode: index === 0 ? 'NONE' : 'ZZZZ99',
    });
    writeJson(join(root, 'sessions', `session-${index + 1}.json`), { ...session, synthetic: false });
  });
}

/** An install that onboarded at T0 and, unless `minutes` is null, recorded its first export that many minutes in. */
function oneInstall(minutes: number | null, at = T0) {
  const seed = {
    installId: newId<'Install'>(),
    sessionId: newId<'TelemetrySession'>(),
    cohort: COHORT_CODE.freshBeta,
  };
  return [
    sessionStarted({ ...seed, at, seq: 0 }, 'en'),
    onboardingStep({ ...seed, at, seq: 1 }, 60_000),
    ...(minutes === null
      ? []
      : [onboardingFirstExport({ ...seed, at: at + minutes * MINUTE_MS, seq: 2 }, minutes * MINUTE_MS)]),
  ];
}

describe('time to first video', () => {
  it('reads onboarding.firstExport for installs new in the window and stays missing input without sessions', () => {
    const root = tempDir();
    const before = Date.parse(`${FIXTURE_FROM}T00:00:00.000Z`) - DAY_MS;
    writeTelemetry(join(root, 'telemetry'), [
      ...oneInstall(16),
      ...oneInstall(null),
      // First seen before --from: its in-window export is not a first video.
      ...oneInstall(1, before).map((envelope, index) => (index === 2 ? { ...envelope, at: T0 } : envelope)),
    ]);
    const cell = findCell(report(root, 'beta', true), { metricId: 'timeToFirstVideo', cohort: 'fresh-beta' });
    expect(cell.value).toBe(16);
    expect(cell.display).toBe('16 min');
    expect(cell.verdict).toBe('missing input');
    expect(cell.decides).toBe(true);
    expect(cell.detail).toContain('telemetry 16 min (n=2, 1 no export)');
  });

  it('lets the session median decide, counts no-export sessions and needs four of them', () => {
    const slow = tempDir();
    writeTelemetry(join(slow, 'telemetry'), oneInstall(10));
    writeSessions(slow, [21 * 60, 21 * 60, 21 * 60, 21 * 60]);
    const failed = findCell(report(slow, 'beta', true, true), {
      metricId: 'timeToFirstVideo',
      cohort: 'fresh-beta',
    });
    expect(failed.value).toBe(21);
    expect(failed.verdict).toBe('fail');

    const fast = tempDir();
    writeTelemetry(join(fast, 'telemetry'), oneInstall(21));
    writeSessions(fast, [10 * 60, 10 * 60, 10 * 60, null]);
    const passed = findCell(report(fast, 'v1', true, true), { metricId: 'timeToFirstVideo' });
    expect(passed.value).toBe(10);
    expect(passed.verdict).toBe('pass');
    expect(passed.detail).toContain('sessions 10 min (n=4, 1 no export)');

    const half = tempDir();
    writeTelemetry(join(half, 'telemetry'), oneInstall(5));
    writeSessions(half, [5 * 60, 5 * 60, null, null]);
    const unreached = findCell(report(half, 'v1', true, true), { metricId: 'timeToFirstVideo' });
    expect(unreached.value).toBeNull();
    expect(unreached.display).toBe('not reached');
    expect(unreached.verdict).toBe('fail');

    const few = tempDir();
    writeTelemetry(join(few, 'telemetry'), oneInstall(5));
    writeSessions(few, [5 * 60, 5 * 60, 5 * 60]);
    expect(findCell(report(few, 'v1', true, true), { metricId: 'timeToFirstVideo' }).verdict).toBe('too few');
  });
});

describe('retention bounds and auto-select', () => {
  it('counts an event on day 22 or day 28 and rejects the minute outside that window', () => {
    function at(deltas: number[]): GateReport {
      const root = tempDir();
      const seed = {
        installId: newId<'Install'>(),
        sessionId: newId<'TelemetrySession'>(),
        cohort: COHORT_CODE.alpha,
      };
      writeTelemetry(join(root, 'telemetry'), [
        exportCompleted(
          { ...seed, at: T0, seq: 0 },
          { firstExport: true, slots: 1, kept: 1, orderChanged: false },
        ),
        ...deltas.map((delta, index) => feedbackSent({ ...seed, at: T0 + delta, seq: index + 1 })),
      ]);
      return report(root, 'v1', true);
    }
    const kept = findCell(at([22 * DAY_MS, 28 * DAY_MS]), { metricId: 'retentionWeek4', cohort: 'alpha' });
    expect(kept.value).toBe(1);
    expect(kept.n).toBe(1);
    expect(kept.verdict).toBe('too few');
    expect(kept.display).not.toBe('no data');
    const missed = findCell(at([21 * DAY_MS, 28 * DAY_MS + 1]), {
      metricId: 'retentionWeek4',
      cohort: 'alpha',
    });
    expect(missed.value).toBe(0);
    expect(missed.display).toBe('0%');
    expect(missed.verdict).toBe('too few');
  });

  it('fails auto-select when the order changed even if every slot was kept', () => {
    const root = tempDir();
    const seed = {
      installId: newId<'Install'>(),
      sessionId: newId<'TelemetrySession'>(),
      cohort: COHORT_CODE.freshBeta,
    };
    const envelopes = [sessionStarted({ ...seed, at: T0, seq: 0 }, 'en')];
    for (let index = 0; index < 20; index += 1) {
      envelopes.push(
        exportCompleted(
          { ...seed, at: T0 + index + 1, seq: index + 1 },
          { firstExport: index === 0, slots: 10, kept: 10, orderChanged: true },
        ),
      );
    }
    writeTelemetry(join(root, 'telemetry'), envelopes);
    const cell = findCell(report(root, 'v1', true), { metricId: 'autoSelectAcceptance' });
    expect(cell.value).toBe(1);
    expect(cell.n).toBe(20);
    expect(cell.verdict).toBe('fail');
    expect(cell.detail).toContain('order unchanged 0%');
  });
});

describe('performance inputs', () => {
  function perfLine(metric: string, unit: string, value: number, synthetic: boolean): string {
    return JSON.stringify({
      v: 1,
      suite: 'perf',
      metric,
      unit,
      value,
      better: metric === 'preview-fps' ? 'higher' : 'lower',
      runner: { id: 'm1-8gb', chip: 'M1', memoryGb: 8, macos: '15' },
      commit: 'fixture',
      date: synthetic ? '2027-01-21' : '2027-01-20',
      synthetic,
      footage: synthetic ? 'synthetic' : 'device-lab',
      build: { flavour: 'beta', version: '0.9.0' },
    });
  }

  function perfReport(lines: string[], ci: boolean): GateReport {
    const root = tempDir();
    writeText(join(root, 'ci', 'nightly.jsonl'), lines.join('\n'));
    if (ci) {
      writeJson(join(root, 'ci', 'performance.json'), {
        id: 'performance',
        pass: true,
        synthetic: false,
        detail: 'ci perf',
        metrics: [
          { name: 'cold-start', value: 1, unit: 'seconds' },
          { name: 'render-60s', value: 60, unit: 'seconds' },
          { name: 'index-1h', value: 30, unit: 'minutes' },
          { name: 'preview-fps', value: 30, unit: 'fps' },
        ],
      });
    }
    return buildReport(
      loadGateInputs({ gate: 'v1', from: FIXTURE_FROM, to: FIXTURE_TO, ci: join(root, 'ci') }),
    );
  }

  it('does not invent cold-start, and does not fall back to CI when a JSONL exists', () => {
    const built = perfReport(
      [
        perfLine('render-60s', 'seconds', 60, false),
        perfLine('index-1h', 'minutes', 30, false),
        perfLine('preview-fps', 'fps', 30, false),
      ],
      true,
    );
    const cell = findCell(built, { metricId: 'performance', runner: 'm1-8gb' });
    expect(cell.value).toBeNull();
    expect(cell.display).toBe('no data');
    expect(cell.verdict).toBe('missing input');
    expect(cell.detail).toContain('cold-start absent');
    expect(cell.detail).toContain('render-60s 60 seconds');
  });

  it('ignores a synthetic cold-start and still lists it', () => {
    const built = perfReport(
      [
        perfLine('cold-start', 'seconds', 99, true),
        perfLine('cold-start', 'seconds', 2.5, false),
        perfLine('render-60s', 'seconds', 60, false),
        perfLine('index-1h', 'minutes', 30, false),
        perfLine('preview-fps', 'fps', 30, false),
      ],
      false,
    );
    const cell = findCell(built, { metricId: 'performance', runner: 'm1-8gb' });
    expect(cell.value).toBe(2.5);
    expect(cell.verdict).toBe('pass');
    expect(cell.synthetic).toBe(true);
    expect(cell.detail).toContain('synthetic cold-start 99 seconds (ignored)');
  });

  it('reads the four CI metrics when no perf JSONL is present', () => {
    const root = tempDir();
    writeJson(join(root, 'ci', 'performance.json'), {
      id: 'performance',
      pass: true,
      synthetic: false,
      detail: 'ci perf',
      metrics: [
        { name: 'cold-start', value: 2.5, unit: 'seconds' },
        { name: 'render-60s', value: 60, unit: 'seconds' },
        { name: 'index-1h', value: 30, unit: 'minutes' },
        { name: 'preview-fps', value: 30, unit: 'fps' },
      ],
    });
    const built = buildReport(
      loadGateInputs({ gate: 'v1', from: FIXTURE_FROM, to: FIXTURE_TO, ci: join(root, 'ci') }),
    );
    expect(findCell(built, { metricId: 'performance', runner: 'ci' })).toMatchObject({
      value: 2.5,
      verdict: 'pass',
    });
  });
});

describe('rejected inputs', () => {
  it('throws on a bad envelope, an unknown cohort, a crash count, a missing path and a bad date', () => {
    const root = tempDir();
    writeText(join(root, 'telemetry', 'events.ndjson'), '{"v":1}\n');
    writeCohortFile(join(root, 'cohorts.json'));
    expect(() =>
      loadGateInputs({
        gate: 'beta',
        from: FIXTURE_FROM,
        to: FIXTURE_TO,
        telemetry: join(root, 'telemetry'),
        cohorts: join(root, 'cohorts.json'),
      }),
    ).toThrow(/is not valid/);

    const unknown = tempDir();
    const seed = { installId: newId<'Install'>(), sessionId: newId<'TelemetrySession'>(), cohort: 'ZZZZ01' };
    writeTelemetry(join(unknown, 'telemetry'), [sessionStarted({ ...seed, at: T0, seq: 0 }, 'en')]);
    writeCohortFile(join(unknown, 'cohorts.json'));
    expect(() =>
      loadGateInputs({
        gate: 'beta',
        from: FIXTURE_FROM,
        to: FIXTURE_TO,
        telemetry: join(unknown, 'telemetry'),
        cohorts: join(unknown, 'cohorts.json'),
      }),
    ).toThrow(/Unknown cohort code ZZZZ01/);

    writeJson(join(root, 'crashes.json'), [
      { release: '1.0.0', channel: 'beta', sessions: 1, crashedSessions: 2 },
    ]);
    expect(() =>
      loadGateInputs({
        gate: 'beta',
        from: FIXTURE_FROM,
        to: FIXTURE_TO,
        crashes: join(root, 'crashes.json'),
      }),
    ).toThrow(/crashedSessions exceeds sessions/);

    expect(() =>
      loadGateInputs({
        gate: 'beta',
        from: FIXTURE_FROM,
        to: FIXTURE_TO,
        telemetry: join(root, 'no-such-telemetry'),
      }),
    ).toThrow(/Cannot read/);

    expect(() => loadGateInputs({ gate: 'beta', from: '2027-02-31', to: FIXTURE_TO })).toThrow(/Bad date/);
  });
});
