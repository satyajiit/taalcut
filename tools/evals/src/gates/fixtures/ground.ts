// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Shared by the generator and the tests. The pass numerators sit on the gate bars; the fail ones sit just under. */
export const FIXTURE_FROM = '2027-01-01';
export const FIXTURE_TO = '2027-02-28';
export const T0 = Date.parse('2027-01-04T12:00:00.000Z');
export const DAY_MS = 86_400_000;
export const MINUTE_MS = 60_000;

export const COHORT_CODE = {
  freshBeta: 'FRESH1',
  beta: 'BETA01',
  alpha: 'ALPHA1',
} as const;

export const GROUND = {
  activation: {
    freshBeta: { installs: 30, passExports: 12, failExports: 11 },
    beta: { installs: 20, passExports: 10, failExports: 9 },
  },
  alpha: { installs: 20, retainedPass: 6, retainedFail: 5 },
  exportsEach: { pass: 3, fail: 2 },
  minutes: { pass: 15, fail: 21 },
  slots: { slots: 10, keptPass: 7, keptFail: 6 },
  qa: { n: 20, passFirst: 16, failFirst: 13 },
  renders: { n: 20, passReady: 10, failReady: 9 },
  cost: { n: 20, passMicros: 250_000, failMicros: 400_001, ignoredMicros: 5_000_000 },
  crash: { sessions: 10_000, crashedPass: 50, crashedFail: 101, release: '1.0.0', channel: 'beta' },
  breakdown: { reels: 20, cleanPass: 18, cleanFail: 17 },
  search: { queries: 20, overallQueries: 80, passHit: 0.8, failEn: 0.75 },
  casting: { pass: 0.82, fail: 0.5 },
  renderQa: { pass: 0.77, fail: 0.5 },
  sessions: 4,
  retentionDays: 25,
  perf: {
    runner: 'm1-8gb',
    small: { id: 'm1-8gb', memoryGb: 8 },
    large: { id: 'm1-16gb', memoryGb: 16 },
    coldStartPass: 2.5,
    coldStartFail: 3,
    renderSeconds: 60,
    indexMinutes: 30,
    previewFps: 30,
  },
} as const;

export type FixtureCase = 'pass' | 'fail' | 'synthetic';

export interface FixtureNumbers {
  freshActivated: number;
  betaActivated: number;
  alphaRetained: number;
  exportsEach: number;
  minutes: number;
  kept: number;
  orderChanged: boolean;
  qaFirst: number;
  renderReady: number;
  costMicros: number;
  cleanReels: number;
  searchEn: number;
  casting: number;
  renderQa: number;
  crashed: number;
  coldStart: number;
  ciPass: boolean;
  manualFailRows: readonly number[];
}

export function numbersFor(fixtureCase: FixtureCase): FixtureNumbers {
  const pass = fixtureCase !== 'fail';
  return {
    freshActivated: pass ? GROUND.activation.freshBeta.passExports : GROUND.activation.freshBeta.failExports,
    betaActivated: pass ? GROUND.activation.beta.passExports : GROUND.activation.beta.failExports,
    alphaRetained: pass ? GROUND.alpha.retainedPass : GROUND.alpha.retainedFail,
    exportsEach: pass ? GROUND.exportsEach.pass : GROUND.exportsEach.fail,
    minutes: pass ? GROUND.minutes.pass : GROUND.minutes.fail,
    kept: pass ? GROUND.slots.keptPass : GROUND.slots.keptFail,
    orderChanged: !pass,
    qaFirst: pass ? GROUND.qa.passFirst : GROUND.qa.failFirst,
    renderReady: pass ? GROUND.renders.passReady : GROUND.renders.failReady,
    costMicros: pass ? GROUND.cost.passMicros : GROUND.cost.failMicros,
    cleanReels: pass ? GROUND.breakdown.cleanPass : GROUND.breakdown.cleanFail,
    searchEn: pass ? GROUND.search.passHit : GROUND.search.failEn,
    casting: pass ? GROUND.casting.pass : GROUND.casting.fail,
    renderQa: pass ? GROUND.renderQa.pass : GROUND.renderQa.fail,
    crashed: pass ? GROUND.crash.crashedPass : GROUND.crash.crashedFail,
    coldStart: pass ? GROUND.perf.coldStartPass : GROUND.perf.coldStartFail,
    ciPass: pass,
    manualFailRows: pass ? [] : [12, 8],
  };
}
