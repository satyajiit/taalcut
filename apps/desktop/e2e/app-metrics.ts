// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Memory while the app works (P3-R1): `app.getAppMetrics()` once a second, through Playwright's evaluate in
 * main, written raw as JSON lines `{ at, metrics }`. Peak memory per process is tools/evals' job
 * (`pnpm --filter @taalcut/evals perf … --app-metrics <file>`, src/perf/inputs.ts), so it is computed one way
 * only. Opt-in: only perf runs and TAALCUT_PERF_DIR start a sampler.
 *
 * What it can't see: processes main didn't start through Electron, such as HyperFrames' headless shell (a
 * child of the render process) and FFmpeg, whisper or the mac helper (children of the utility processes).
 */
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ElectronApplication } from '@playwright/test';

export interface MetricsSampler {
  /** Stops sampling; how many samples were written. */
  stop(): Promise<{ readonly samples: number; readonly file: string }>;
}

/** Samples every `everyMs` into `file` (replaced) until stop(). */
export function sampleAppMetrics(app: ElectronApplication, file: string, everyMs = 1000): MetricsSampler {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, '');
  let samples = 0;
  let stopped = false;

  const loop = (async () => {
    while (!stopped) {
      // The app may be closing: a sample it can't answer is simply not written.
      const metrics = await app.evaluate(({ app: main }) => main.getAppMetrics()).catch(() => null);
      if (metrics) {
        appendFileSync(file, `${JSON.stringify({ at: Date.now(), metrics })}\n`);
        samples += 1;
      }
      await new Promise((resolve) => setTimeout(resolve, everyMs));
    }
  })();

  return {
    async stop() {
      stopped = true;
      await loop;
      return { samples, file };
    },
  };
}
