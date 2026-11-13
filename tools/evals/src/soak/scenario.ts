// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { setTimeout as delay } from 'node:timers/promises';
import { importedFailures, integrityFailures, type AssetHash, type IntegritySnapshot } from './integrity';
import { buildSoakResult, NO_APP_WIRED, unwiredSoakResult, type SoakMode, type SoakResult } from './result';
import { type GrowthScore, type SoakRssSample } from './score';

export type { SoakMode, SoakResult };

export interface SoakClock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export interface FakeClock extends SoakClock {
  readonly sleeps: readonly number[];
  readonly sleptMs: number;
}

/** Advances on sleep without waiting. Tests and smoke use this; it never arms a real timer. */
export function fakeClock(start = 0): FakeClock {
  let time = start;
  const sleeps: number[] = [];
  return {
    now: () => time,
    async sleep(ms: number) {
      if (!Number.isFinite(ms) || ms < 0)
        throw new Error(`sleep expects a non-negative finite ms, got ${ms}`);
      sleeps.push(ms);
      time += ms;
    },
    get sleeps() {
      return sleeps;
    },
    get sleptMs() {
      return sleeps.reduce((sum, ms) => sum + ms, 0);
    },
  };
}

/** Wall clock. Not used by smoke, tests, or an unwired full run. */
export function systemClock(): SoakClock {
  return {
    now: () => Date.now(),
    sleep(ms: number) {
      if (!Number.isFinite(ms) || ms < 0) {
        return Promise.reject(new Error(`sleep expects a non-negative finite ms, got ${ms}`));
      }
      return delay(ms).then(() => undefined);
    },
  };
}

export interface SoakSample extends SoakRssSample {
  dbBytes: number;
  queueDepth: number;
}

export interface SoakApp {
  importBatch(count: number): Promise<{ imported: number; hashes: { id: string; sha256: string }[] }>;
  wifiUpload(): Promise<{ id: string; sha256: string }>;
  indexIdle(): Promise<boolean>;
  renderOnce(): Promise<{ id: string; bytes: number; probed: boolean }>;
  sample(): Promise<{ processes: { name: string; rssBytes: number }[]; dbBytes: number; queueDepth: number }>;
  integrity(): Promise<IntegritySnapshot>;
  offerUpdate(): Promise<void>;
  quitInstallRelaunch(): Promise<{ resumed: boolean }>;
  forceFailedBuild(): Promise<void>;
  rollback(): Promise<{ restored: boolean; dataLost: boolean }>;
}

export interface SoakSink {
  recordSample(sample: SoakSample): void;
  fail(name: string): void;
  /** A file the app imported, with the hash it reported. Checked against the asset list at the end. */
  imported(asset: AssetHash): void;
}

export interface SoakScenario {
  id: string;
  /** Nominal full-run length. Zero when the scenario is counted in renders or steps, not hours. */
  hours: number;
  checks: readonly string[];
  run(app: SoakApp, clock: SoakClock, sink: SoakSink, mode: SoakMode): Promise<void>;
  score(samples: readonly SoakRssSample[], mode: SoakMode): GrowthScore;
}

const UNWIRED = Symbol('soak-unwired');

/** Default app: the runner records `missing` and does not start the scenario clock. */
export function unavailableApp(): SoakApp {
  const refuse = (): Promise<never> => Promise.reject(new Error(NO_APP_WIRED));
  const app: SoakApp = {
    importBatch: refuse,
    wifiUpload: refuse,
    indexIdle: refuse,
    renderOnce: refuse,
    sample: refuse,
    integrity: refuse,
    offerUpdate: refuse,
    quitInstallRelaunch: refuse,
    forceFailedBuild: refuse,
    rollback: refuse,
  };
  Object.defineProperty(app, UNWIRED, { value: true });
  return app;
}

export function isUnwired(app: SoakApp): boolean {
  return Reflect.get(app, UNWIRED) === true;
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

export async function runScenario(input: {
  scenario: SoakScenario;
  app: SoakApp;
  clock: SoakClock;
  mode: SoakMode;
  synthetic: boolean;
}): Promise<SoakResult> {
  const startedAt = iso(input.clock.now());
  if (isUnwired(input.app)) {
    return unwiredSoakResult({
      scenario: input.scenario.id,
      mode: input.mode,
      startedAt,
      finishedAt: iso(input.clock.now()),
      synthetic: input.synthetic,
    });
  }
  const samples: SoakSample[] = [];
  const scenarioFailures: string[] = [];
  const imported: AssetHash[] = [];
  const sink: SoakSink = {
    recordSample(sample) {
      samples.push(sample);
    },
    fail(name) {
      scenarioFailures.push(name);
    },
    imported(asset) {
      imported.push(asset);
    },
  };
  await input.scenario.run(input.app, input.clock, sink, input.mode);
  const snapshot = await input.app.integrity();
  const failedIntegrity = [...integrityFailures(snapshot), ...importedFailures(imported, snapshot.assets)];
  const growth = input.scenario.score(samples, input.mode);
  return buildSoakResult({
    scenario: input.scenario.id,
    mode: input.mode,
    startedAt,
    finishedAt: iso(input.clock.now()),
    synthetic: input.synthetic,
    growth,
    integrityFailures: failedIntegrity,
    scenarioFailures,
  });
}
