// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { cleanIntegrity, type IntegritySnapshot } from './integrity';
import { fakeClock, runScenario, type SoakApp, type SoakResult, type SoakScenario } from './scenario';
import { SOAK_SCENARIOS } from './scenarios';

const DEFAULT_RSS = 100_000_000;

export interface SmokeAppOptions {
  /** RSS samples, in call order. A short script repeats its last value. Replace the array on the app. */
  rssScript?: number[];
  processName?: string;
  resumed?: boolean;
  restored?: boolean;
  dataLost?: boolean;
  /** True means the indexer has gone idle, which fails `import-index-8h`. */
  indexIdle?: boolean;
  integrity?: IntegritySnapshot;
  probed?: boolean;
  renderBytes?: number;
}

export interface SmokeApp extends SoakApp {
  readonly assets: ReadonlyMap<string, string>;
  rssScript: number[];
}

/**
 * In-process fake. Records import and upload hashes, probes a tiny render, and returns the scripted RSS.
 * Deterministic: it never waits on a timer. `TAALCUT_SOAK_SMOKE` is not required.
 */
export function smokeApp(options: SmokeAppOptions = {}): SmokeApp {
  const assets = new Map<string, string>();
  const state = {
    rssScript: options.rssScript ?? [DEFAULT_RSS],
    next: 0,
    sampleIndex: 0,
  };
  const processName = options.processName ?? 'main';
  const remember = (prefix: string): { id: string; sha256: string } => {
    const n = state.next;
    state.next += 1;
    const id = `${prefix}-${n}`;
    const sha256 = n.toString(16).padStart(64, '0');
    assets.set(id, sha256);
    return { id, sha256 };
  };
  const app: SmokeApp = {
    assets,
    get rssScript() {
      return state.rssScript;
    },
    set rssScript(next: number[]) {
      state.rssScript = next;
    },
    async importBatch(count: number) {
      const hashes: { id: string; sha256: string }[] = [];
      for (let index = 0; index < count; index += 1) hashes.push(remember('import'));
      return { imported: hashes.length, hashes };
    },
    async wifiUpload() {
      return remember('wifi');
    },
    async indexIdle() {
      return options.indexIdle === true;
    },
    async renderOnce() {
      const recorded = remember('render');
      return { id: recorded.id, bytes: options.renderBytes ?? 1024, probed: options.probed !== false };
    },
    async sample() {
      const script = state.rssScript;
      const index = script.length === 0 ? 0 : Math.min(state.sampleIndex, script.length - 1);
      const rssBytes = script[index] ?? DEFAULT_RSS;
      state.sampleIndex += 1;
      return {
        processes: [{ name: processName, rssBytes }],
        dbBytes: 4096,
        queueDepth: 0,
      };
    },
    async integrity() {
      const now = [...assets.entries()].map(([id, sha256]) => ({ id, sha256 }));
      return options.integrity ?? cleanIntegrity(now);
    },
    async offerUpdate() {
      return undefined;
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
  return app;
}

export interface RunSmokeOptions {
  app?: SoakApp;
  scenarios?: readonly SoakScenario[];
}

/**
 * Runs the registered scenarios with `mode: 'smoke'`. Each scenario applies its own short
 * durations; this function does not reimplement them. A fresh fake clock per scenario, so
 * nothing here waits out the 8 h soak.
 */
export async function runSmoke(options: RunSmokeOptions = {}): Promise<SoakResult[]> {
  const scenarios = options.scenarios ?? SOAK_SCENARIOS;
  const app = options.app ?? smokeApp();
  const results: SoakResult[] = [];
  for (const scenario of scenarios) {
    results.push(
      await runScenario({
        scenario,
        app,
        clock: fakeClock(),
        mode: 'smoke',
        synthetic: true,
      }),
    );
  }
  return results;
}
