// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GROUND } from '../../src/gates/fixtures';
import { type GateCell, type GateId } from '../../src/gates/gate-metric';
import { type GateReport } from '../../src/gates/report/build';
import { renderMarkdown } from '../../src/gates/report/markdown';
import { wilson } from '../../src/gates/stats';
import { findCell } from './cell';
import { reportFor, writtenFixture } from './fixture-report';

const INSTALLS =
  GROUND.activation.freshBeta.installs + GROUND.activation.beta.installs + GROUND.alpha.installs;

const passRoot = writtenFixture('pass');
const failRoot = writtenFixture('fail');
const syntheticRoot = writtenFixture('synthetic');

const built = new Map<string, GateReport>();

function report(fixtureCase: 'pass' | 'fail', gate: GateId): GateReport {
  const key = `${fixtureCase}:${gate}`;
  const cached = built.get(key);
  if (cached !== undefined) return cached;
  const next = reportFor(fixtureCase === 'pass' ? passRoot : failRoot, gate);
  built.set(key, next);
  return next;
}

function rate(cell: GateCell, successes: number, n: number, verdict: 'pass' | 'fail'): void {
  expect(cell.value).toBe(successes / n);
  expect(cell.n).toBe(n);
  expect(cell.verdict).toBe(verdict);
  expect(cell.display).not.toBe('no data');
  expect(cell.value).not.toBe(0);
}

describe('gate fixtures', () => {
  it('hits every gate bar on the pass fixture and sits just under it on the fail fixture', () => {
    expect(GROUND.activation.freshBeta).toEqual({ installs: 30, passExports: 12, failExports: 11 });
    const fresh = GROUND.activation.freshBeta;
    const beta = GROUND.activation.beta;
    const crashPass = GROUND.crash.sessions - GROUND.crash.crashedPass;
    const crashFail = GROUND.crash.sessions - GROUND.crash.crashedFail;
    const passExports = INSTALLS * GROUND.exportsEach.pass;
    const failExports = INSTALLS * GROUND.exportsEach.fail;

    rate(
      findCell(report('pass', 'beta'), { metricId: 'activation', cohort: 'fresh-beta' }),
      fresh.passExports,
      fresh.installs,
      'pass',
    );
    rate(
      findCell(report('fail', 'beta'), { metricId: 'activation', cohort: 'fresh-beta' }),
      fresh.failExports,
      fresh.installs,
      'fail',
    );
    rate(
      findCell(report('pass', 'v1'), { metricId: 'activation', cohort: 'beta' }),
      beta.passExports,
      beta.installs,
      'pass',
    );
    rate(
      findCell(report('fail', 'v1'), { metricId: 'activation', cohort: 'beta' }),
      beta.failExports,
      beta.installs,
      'fail',
    );

    expect(
      findCell(report('pass', 'beta'), { metricId: 'timeToFirstVideo', cohort: 'fresh-beta' }),
    ).toMatchObject({
      value: GROUND.minutes.pass,
      n: GROUND.sessions,
      verdict: 'pass',
      display: '15 min',
    });
    expect(findCell(report('fail', 'v1'), { metricId: 'timeToFirstVideo' })).toMatchObject({
      value: GROUND.minutes.fail,
      n: GROUND.sessions,
      verdict: 'fail',
      display: '21 min',
    });

    const autoPass = findCell(report('pass', 'v1'), { metricId: 'autoSelectAcceptance' });
    const autoFail = findCell(report('fail', 'beta'), { metricId: 'autoSelectAcceptance' });
    expect(autoPass.value).toBe(GROUND.slots.keptPass / GROUND.slots.slots);
    expect(autoPass.n).toBe(passExports);
    expect(autoPass.verdict).toBe('pass');
    expect(autoPass.detail).toContain('order unchanged 100%');
    expect(autoPass.detail).toContain('casting pickAcceptance');
    expect(autoPass.interval).toEqual(
      wilson(passExports * GROUND.slots.keptPass, passExports * GROUND.slots.slots),
    );
    expect(autoFail.value).toBe(GROUND.slots.keptFail / GROUND.slots.slots);
    expect(autoFail.n).toBe(failExports);
    expect(autoFail.verdict).toBe('fail');
    expect(autoFail.detail).toContain('order unchanged 0%');

    rate(
      findCell(report('pass', 'v1'), { metricId: 'breakdownAccuracy' }),
      GROUND.breakdown.cleanPass,
      GROUND.breakdown.reels,
      'pass',
    );
    rate(
      findCell(report('fail', 'beta'), { metricId: 'breakdownAccuracy' }),
      GROUND.breakdown.cleanFail,
      GROUND.breakdown.reels,
      'fail',
    );

    const qaPass = findCell(report('pass', 'v1'), { metricId: 'qaFirstPass' });
    const qaFail = findCell(report('fail', 'beta'), { metricId: 'qaFirstPass' });
    rate(qaPass, GROUND.qa.passFirst, GROUND.qa.n, 'pass');
    rate(qaFail, GROUND.qa.failFirst, GROUND.qa.n, 'fail');
    expect(qaPass.detail).toContain('render qaFirstPass');
    expect(qaPass.detail).not.toContain('0%');

    rate(
      findCell(report('pass', 'v1'), { metricId: 'exportRate' }),
      GROUND.renders.passReady,
      GROUND.renders.n,
      'pass',
    );
    rate(
      findCell(report('fail', 'v1'), { metricId: 'exportRate' }),
      GROUND.renders.failReady,
      GROUND.renders.n,
      'fail',
    );
    expect(report('pass', 'beta').cells.some((cell) => cell.metricId === 'exportRate')).toBe(false);

    expect(findCell(report('pass', 'v1'), { metricId: 'weeklyOutput' })).toMatchObject({
      value: GROUND.exportsEach.pass,
      n: INSTALLS,
      verdict: 'pass',
      display: '3',
      detail: 'exports ÷ active install-weeks 3; median 3',
    });
    expect(findCell(report('fail', 'v1'), { metricId: 'weeklyOutput' })).toMatchObject({
      value: GROUND.exportsEach.fail,
      n: INSTALLS,
      verdict: 'fail',
    });

    rate(
      findCell(report('pass', 'v1'), { metricId: 'retentionWeek4', cohort: 'alpha' }),
      GROUND.alpha.retainedPass,
      GROUND.alpha.installs,
      'pass',
    );
    rate(
      findCell(report('fail', 'v1'), { metricId: 'retentionWeek4', cohort: 'alpha' }),
      GROUND.alpha.retainedFail,
      GROUND.alpha.installs,
      'fail',
    );

    expect(findCell(report('pass', 'v1'), { metricId: 'costPerVideo' })).toMatchObject({
      value: GROUND.cost.passMicros / 1_000_000,
      n: GROUND.cost.n,
      verdict: 'pass',
      display: '$0.25',
    });
    expect(findCell(report('fail', 'beta'), { metricId: 'costPerVideo' })).toMatchObject({
      value: GROUND.cost.failMicros / 1_000_000,
      n: GROUND.cost.n,
      verdict: 'fail',
    });

    rate(findCell(report('pass', 'v1'), { metricId: 'crashFree' }), crashPass, GROUND.crash.sessions, 'pass');
    rate(
      findCell(report('fail', 'beta'), { metricId: 'crashFree' }),
      crashFail,
      GROUND.crash.sessions,
      'fail',
    );
    const crashSlice = findCell(report('pass', 'beta'), {
      metricId: 'crashFree',
      release: GROUND.crash.release,
    });
    expect(crashSlice.slice.channel).toBe(GROUND.crash.channel);
    expect(crashSlice.value).toBe(crashPass / GROUND.crash.sessions);

    for (const language of ['all', 'en', 'hi', 'es', 'pt-BR'] as const) {
      const found = findCell(report('pass', 'v1'), { metricId: 'searchTop5', language });
      expect(found.value).toBe(GROUND.search.passHit);
      expect(found.n).toBe(language === 'all' ? GROUND.search.overallQueries : GROUND.search.queries);
      expect(found.verdict).toBe('pass');
    }
    const failEn = findCell(report('fail', 'v1'), { metricId: 'searchTop5', language: 'en' });
    expect(failEn.value).toBe(GROUND.search.failEn);
    expect(failEn.verdict).toBe('fail');
    expect(findCell(report('fail', 'v1'), { metricId: 'searchTop5', language: 'hi' }).verdict).toBe('pass');

    expect(findCell(report('pass', 'beta'), { metricId: 'updateAndRollback' })).toMatchObject({
      value: 1,
      verdict: 'pass',
      display: 'pass',
    });
    expect(findCell(report('fail', 'beta'), { metricId: 'updateAndRollback' })).toMatchObject({
      value: 0,
      verdict: 'fail',
      display: 'fail',
    });
    expect(findCell(report('pass', 'v1'), { metricId: 'languagesReady' })).toMatchObject({
      value: 1,
      verdict: 'pass',
    });
    expect(findCell(report('fail', 'v1'), { metricId: 'languagesReady' })).toMatchObject({
      value: 0,
      verdict: 'fail',
    });
    expect(findCell(report('pass', 'v1'), { metricId: 'accessibility' })).toMatchObject({
      value: 1,
      verdict: 'pass',
    });
    expect(findCell(report('fail', 'v1'), { metricId: 'accessibility' })).toMatchObject({
      value: 0,
      verdict: 'fail',
    });

    expect(
      findCell(report('pass', 'v1'), { metricId: 'performance', runner: GROUND.perf.runner }),
    ).toMatchObject({
      value: GROUND.perf.coldStartPass,
      verdict: 'pass',
      display: '2.5 seconds',
    });
    expect(
      findCell(report('fail', 'v1'), { metricId: 'performance', runner: GROUND.perf.runner }),
    ).toMatchObject({
      value: GROUND.perf.coldStartFail,
      verdict: 'fail',
    });

    expect(findCell(report('pass', 'v1'), { metricId: 'performance' })).toMatchObject({
      value: 1,
      verdict: 'pass',
      decides: true,
    });
    expect(findCell(report('fail', 'v1'), { metricId: 'performance' })).toMatchObject({
      value: 0,
      verdict: 'fail',
      decides: true,
    });
    expect(findCell(report('pass', 'v1'), { metricId: 'manualSignOff', row: 9 }).verdict).toBe('pass');
    expect(report('pass', 'v1').cells.some((cell) => cell.metricId === 'updateAndRollback')).toBe(false);

    expect(findCell(report('pass', 'beta'), { metricId: 'manualSignOff', row: 9 }).verdict).toBe('pass');
    expect(findCell(report('fail', 'beta'), { metricId: 'manualSignOff', row: 12 })).toMatchObject({
      value: 0,
      verdict: 'fail',
    });
    expect(findCell(report('pass', 'v1'), { metricId: 'manualSignOff', row: 4 }).verdict).toBe('pass');
    expect(findCell(report('fail', 'v1'), { metricId: 'manualSignOff', row: 8 })).toMatchObject({
      value: 0,
      verdict: 'fail',
      display: 'fail',
    });
  });

  it('gives every plan row one verdict from its deciding cells', () => {
    const pass = report('pass', 'v1');
    expect(pass.rows.map((row) => row.row)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    for (const row of pass.rows) {
      expect(row.cells.length, `row ${row.row}`).toBeGreaterThan(0);
      for (const cell of row.cells) expect(cell.slice.language).toBe('all');
    }
    expect(pass.rows.every((row) => row.verdict === 'pass')).toBe(true);
    // Only the binding cohort decides: activation's v1 cell is the beta cohort, not fresh-beta (12/30 fails).
    const rowOne = pass.rows.find((row) => row.row === 1);
    expect(
      rowOne?.cells.filter((cell) => cell.metricId === 'activation').map((cell) => cell.slice.cohort),
    ).toEqual(['beta']);
    const fail = report('fail', 'v1');
    expect(fail.rows.find((row) => row.row === 3)?.verdict).toBe('fail');
    // Search fails on English alone, so the deciding cell fails although overall hit@5 is at the bar.
    const search = findCell(fail, { metricId: 'searchTop5' });
    expect(search.value).toBe(GROUND.search.passHit);
    expect(search.verdict).toBe('fail');
    expect(renderMarkdown(fail)).toContain('## Gate rows');
    expect(renderMarkdown(fail)).toMatch(/\| 3 \| fail \| Search top-5 80% \(>= 80%\): fail \|/);
  });

  it('shows the other cohorts, and does not turn an empty slice into zero', () => {
    const beta = report('pass', 'beta');
    const cohort = findCell(beta, { metricId: 'activation', cohort: 'beta' });
    expect(cohort.n).toBe(GROUND.activation.beta.installs);
    expect(cohort.value).toBe(GROUND.activation.beta.passExports / GROUND.activation.beta.installs);
    expect(cohort.verdict).toBe('too few');
    const spanish = findCell(beta, { metricId: 'activation', cohort: 'alpha', language: 'es' });
    expect(spanish.n).toBe(GROUND.alpha.installs / 2);
    expect(spanish.value).toBe(1);
    expect(spanish.verdict).toBe('too few');
    const empty = findCell(beta, { metricId: 'activation', cohort: 'fresh-beta', language: 'hi' });
    expect(empty.value).toBeNull();
    expect(empty.n).toBe(0);
    expect(empty.display).toBe('no data');
    expect(empty.verdict).toBe('missing input');
    const freshOnV1 = findCell(report('pass', 'v1'), { metricId: 'activation', cohort: 'fresh-beta' });
    expect(freshOnV1.value).toBe(12 / 30);
    expect(freshOnV1.verdict).toBe('fail');
  });

  it('keeps a null value as missing input and never as a pass', () => {
    for (const gate of ['beta', 'v1'] as const) {
      for (const cell of [...report('pass', gate).cells, ...report('fail', gate).cells]) {
        if (cell.value === null && cell.display === 'not reached') {
          expect(['fail', 'too few']).toContain(cell.verdict);
        } else if (cell.value === null) {
          expect(cell.display).toBe('no data');
          expect(cell.verdict).toBe('missing input');
        } else {
          expect(cell.display).not.toBe('no data');
        }
        if (cell.verdict === 'too few') expect(cell.value).not.toBeNull();
        if (cell.value !== null) {
          expect(cell.sources.length).toBeGreaterThan(0);
          for (const source of cell.sources) expect(source.sha256).toMatch(/^[a-f0-9]{64}$/);
        }
      }
    }
    const activation = findCell(report('pass', 'beta'), { metricId: 'activation', cohort: 'fresh-beta' });
    expect(activation.interval).toEqual(wilson(12, 30));
    const ndjson = activation.sources.find((source) => source.path.endsWith('events.ndjson'));
    expect(ndjson).toBeDefined();
    if (ndjson !== undefined) {
      const bytes = readFileSync(ndjson.path);
      expect(ndjson.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    }
  });

  it('leaves activation missing, not zero, when the telemetry directory is omitted', () => {
    const built = reportFor(passRoot, 'v1', ['telemetry']);
    const activation = findCell(built, { metricId: 'activation', cohort: 'beta' });
    expect(activation.verdict).toBe('missing input');
    expect(activation.value).toBeNull();
    expect(activation.display).toBe('no data');
    const qa = findCell(built, { metricId: 'qaFirstPass' });
    expect(qa.verdict).toBe('missing input');
    expect(qa.value).toBeNull();
    expect(qa.detail).toContain('render qaFirstPass');
    const picked = findCell(built, { metricId: 'autoSelectAcceptance' });
    expect(picked.value).toBeNull();
    expect(picked.detail).toContain('casting pickAcceptance');
    expect(findCell(built, { metricId: 'breakdownAccuracy' }).value).toBe(
      GROUND.breakdown.cleanPass / GROUND.breakdown.reels,
    );
    expect(findCell(built, { metricId: 'exportRate' }).value).toBeNull();
  });

  it('flags synthetic telemetry without changing the pass, and says so in the report', () => {
    const built = reportFor(syntheticRoot, 'beta');
    const activation = findCell(built, { metricId: 'activation', cohort: 'fresh-beta' });
    expect(activation.synthetic).toBe(true);
    expect(activation.verdict).toBe('pass');
    expect(activation.value).toBe(
      GROUND.activation.freshBeta.passExports / GROUND.activation.freshBeta.installs,
    );
    // Every generated document is marked in the synthetic case, not only the telemetry.
    for (const cell of built.cells) expect(cell.synthetic, cell.metricId).toBe(true);
    expect(built.synthetic).toBe(true);
    expect(renderMarkdown(built)).toContain('Synthetic: yes. These numbers are not a gate result.');
    expect(renderMarkdown(report('pass', 'beta'))).toContain('Synthetic: no.');
  });
});
