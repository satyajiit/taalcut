// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import { cleanIntegrity, type IntegritySnapshot } from '../../src/soak/integrity';
import { SOAK_SCENARIOS } from '../../src/soak/scenarios';
import {
  BATCH_INTERVAL_MS,
  FULL_BATCHES,
  FULL_UPLOADS,
  IMPORT_DURATION_MS,
  SMOKE_BATCH_INTERVAL_MS,
  SMOKE_BATCHES,
  SMOKE_DURATION_MS,
  SMOKE_UPLOADS,
  UPLOAD_INTERVAL_MS,
  importIndexScenario,
  importSchedule,
} from '../../src/soak/scenarios/import-index-8h';
import { FULL_RENDERS, SMOKE_RENDERS, rendersScenario } from '../../src/soak/scenarios/renders-50';
import { updateUnderLoadScenario } from '../../src/soak/scenarios/update-under-load';
import {
  fakeClock,
  runScenario,
  unavailableApp,
  type SoakApp,
  type SoakClock,
} from '../../src/soak/scenario';

interface RecordingApp extends SoakApp {
  batchAt: number[];
  uploadAt: number[];
  /** Imports and renders started and not finished when the update was offered. */
  readonly inFlightAtOffer: number | null;
  readonly renders: number;
  readonly idleChecks: number;
  readonly samples: number;
}

function recordingApp(
  clock: SoakClock,
  options: {
    idle?: boolean;
    resumed?: boolean;
    restored?: boolean;
    dataLost?: boolean;
    integrity?: Partial<IntegritySnapshot>;
  } = {},
): RecordingApp {
  const batchAt: number[] = [];
  const uploadAt: number[] = [];
  const recorded: { id: string; sha256: string }[] = [];
  const state = { renders: 0, idleChecks: 0, samples: 0, next: 0, inFlight: 0, inFlightAtOffer: -1 };
  const sha = (): { id: string; sha256: string } => {
    const n = state.next;
    state.next += 1;
    const asset = { id: `id-${n}`, sha256: 'a'.repeat(64) };
    recorded.push(asset);
    return asset;
  };
  /** Work that finishes a microtask later, so the caller can act while it is in flight. */
  const inFlight = async <T>(make: () => T): Promise<T> => {
    state.inFlight += 1;
    await Promise.resolve();
    state.inFlight -= 1;
    return make();
  };
  return {
    batchAt,
    uploadAt,
    get inFlightAtOffer() {
      return state.inFlightAtOffer < 0 ? null : state.inFlightAtOffer;
    },
    get renders() {
      return state.renders;
    },
    get idleChecks() {
      return state.idleChecks;
    },
    get samples() {
      return state.samples;
    },
    importBatch(count) {
      batchAt.push(clock.now());
      return inFlight(() => ({ imported: count, hashes: Array.from({ length: count }, () => sha()) }));
    },
    async wifiUpload() {
      uploadAt.push(clock.now());
      return sha();
    },
    async indexIdle() {
      state.idleChecks += 1;
      return options.idle === true;
    },
    renderOnce() {
      state.renders += 1;
      return inFlight(() => ({ id: `render-${state.renders}`, bytes: 32, probed: true }));
    },
    async sample() {
      state.samples += 1;
      return { processes: [{ name: 'main', rssBytes: 1000 }], dbBytes: 8, queueDepth: 1 };
    },
    async integrity() {
      return { ...cleanIntegrity(recorded), ...options.integrity };
    },
    async offerUpdate() {
      state.inFlightAtOffer = state.inFlight;
    },
    async quitInstallRelaunch() {
      return { resumed: options.resumed !== false };
    },
    async forceFailedBuild() {
      return undefined;
    },
    async rollback() {
      return { restored: options.restored !== false, dataLost: options.dataLost === true };
    },
  };
}

describe('import-index-8h', () => {
  it('schedules 48 batches and 16 uploads across 8h without waiting', async () => {
    const clock = fakeClock();
    const app = recordingApp(clock);
    const started = Date.now();
    const result = await runScenario({
      scenario: importIndexScenario,
      app,
      clock,
      mode: 'full',
      synthetic: true,
    });
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(importSchedule('full').batches).toBe((8 * 60) / 10);
    expect(FULL_BATCHES).toBe(48);
    expect(FULL_UPLOADS).toBe(16);
    expect(app.batchAt).toEqual(Array.from({ length: 48 }, (_, index) => index * BATCH_INTERVAL_MS));
    expect(app.uploadAt).toEqual(Array.from({ length: 16 }, (_, index) => index * UPLOAD_INTERVAL_MS));
    expect(app.idleChecks).toBe(48 + 16);
    expect(clock.sleptMs).toBe(IMPORT_DURATION_MS);
    expect(clock.sleeps.some((ms) => ms >= 8 * 60 * 60 * 1000)).toBe(false);
    expect(result.verdict).toBe('pass');
    expect(result.synthetic).toBe(true);
  });

  it('schedules 2 batches and 1 upload in smoke mode', async () => {
    const clock = fakeClock();
    const app = recordingApp(clock);
    const result = await runScenario({
      scenario: importIndexScenario,
      app,
      clock,
      mode: 'smoke',
      synthetic: true,
    });
    expect(SMOKE_BATCHES).toBe(2);
    expect(SMOKE_UPLOADS).toBe(1);
    expect(app.batchAt).toEqual([0, SMOKE_BATCH_INTERVAL_MS]);
    expect(app.uploadAt).toEqual([0]);
    expect(clock.sleptMs).toBe(SMOKE_DURATION_MS);
    expect(result.verdict).toBe('pass');
  });

  it('names an idle indexer', async () => {
    const clock = fakeClock();
    const app = recordingApp(clock, { idle: true });
    const result = await runScenario({
      scenario: importIndexScenario,
      app,
      clock,
      mode: 'smoke',
      synthetic: true,
    });
    expect(result.verdict).toBe('fail');
    expect(result.detail).toContain('index-idle:batch:1');
    expect(result.detail).toContain('index-idle:batch:2');
    expect(result.detail).toContain('index-idle:upload:1');
  });

  it('does not start the 8h clock when no app is wired', async () => {
    const clock = fakeClock();
    const result = await runScenario({
      scenario: importIndexScenario,
      app: unavailableApp(),
      clock,
      mode: 'full',
      synthetic: false,
    });
    expect(result.verdict).toBe('missing');
    expect(result.detail).toBe('no app wired');
    expect(result.synthetic).toBe(false);
    expect(clock.sleeps).toEqual([]);
    expect(result.growth).toEqual([]);
  });
});

describe('renders-50', () => {
  it('calls renderOnce 50 times in full mode and 2 in smoke', async () => {
    const fullClock = fakeClock();
    const fullApp = recordingApp(fullClock);
    const full = await runScenario({
      scenario: rendersScenario,
      app: fullApp,
      clock: fullClock,
      mode: 'full',
      synthetic: true,
    });
    expect(fullApp.renders).toBe(FULL_RENDERS);
    expect(FULL_RENDERS).toBe(50);
    expect(full.verdict).toBe('pass');
    expect(full.growth[0]?.ratio).toBe(0);

    const smokeClock = fakeClock();
    const smokeApp = recordingApp(smokeClock);
    const smoke = await runScenario({
      scenario: rendersScenario,
      app: smokeApp,
      clock: smokeClock,
      mode: 'smoke',
      synthetic: true,
    });
    expect(smokeApp.renders).toBe(SMOKE_RENDERS);
    expect(SMOKE_RENDERS).toBe(2);
    expect(smoke.verdict).toBe('pass');
  });
});

describe('update-under-load', () => {
  async function run(options: { resumed?: boolean; restored?: boolean; dataLost?: boolean }) {
    const clock = fakeClock();
    const app = recordingApp(clock, options);
    return runScenario({
      scenario: updateUnderLoadScenario,
      app,
      clock,
      mode: 'smoke',
      synthetic: true,
    });
  }

  it('fails when relaunch does not resume', async () => {
    const result = await run({ resumed: false });
    expect(result.verdict).toBe('fail');
    expect(result.detail).toContain('update-not-resumed');
  });

  it('fails when rollback loses data', async () => {
    const result = await run({ dataLost: true });
    expect(result.verdict).toBe('fail');
    expect(result.detail).toContain('data-lost');
  });

  it('fails when rollback does not restore', async () => {
    const result = await run({ restored: false });
    expect(result.verdict).toBe('fail');
    expect(result.detail).toContain('rollback-not-restored');
  });

  it('passes the happy sequence', async () => {
    const result = await run({});
    expect(result.verdict).toBe('pass');
    expect(result.detail).toBe('ok');
  });

  it('offers the update while the import and the render are still in flight', async () => {
    const clock = fakeClock();
    const app = recordingApp(clock);
    await runScenario({ scenario: updateUnderLoadScenario, app, clock, mode: 'smoke', synthetic: true });
    expect(app.inFlightAtOffer).toBe(2);
  });

  it('names an imported file that changed or vanished by the end of the run', async () => {
    const clock = fakeClock();
    const app = recordingApp(clock, { integrity: { assets: [{ id: 'id-0', sha256: 'b'.repeat(64) }] } });
    const result = await runScenario({
      scenario: importIndexScenario,
      app,
      clock,
      mode: 'smoke',
      synthetic: true,
    });
    expect(result.verdict).toBe('fail');
    expect(result.integrityFailures).toContain('asset-changed:id-0');
    expect(result.integrityFailures).toContain('asset-missing:id-1');
  });

  it('names a planted integrity fault on the result', async () => {
    const clock = fakeClock();
    const app = recordingApp(clock, {
      integrity: { orphanScratch: ['leftover-scratch'] },
    });
    const result = await runScenario({
      scenario: updateUnderLoadScenario,
      app,
      clock,
      mode: 'full',
      synthetic: true,
    });
    expect(result.verdict).toBe('fail');
    expect(result.integrityFailures).toEqual(['orphan-scratch:leftover-scratch']);
  });
});

describe('SOAK_SCENARIOS', () => {
  it('registers each scenario once, with no id switch in the list', () => {
    expect(SOAK_SCENARIOS.map((scenario) => scenario.id)).toEqual([
      'import-index-8h',
      'renders-50',
      'update-under-load',
    ]);
  });
});
