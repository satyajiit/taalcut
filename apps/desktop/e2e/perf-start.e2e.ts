// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Cold start (P3-R1, v1.0 gate criterion 7: under 3 s), measured on this Mac with perf-launch.ts: the test
 * build in out/ (the code users get, unbundled from an ASAR) and, when scripts/package-e2e.mjs has made it,
 * the packaged test build. That one ships the placeholder page, not the app, so it measures main's start from
 * the ASAR to the window's first paint only (interactive: null). Each gets one first launch on a fresh userData (the library is created and
 * migrated; the OS file cache is warm, so this is not a cold boot) and five warm launches on the same
 * userData. First run is marked done, so every launch opens on the chat. Results go to
 * $TAALCUT_PERF_DIR/start.json (default test-results/perf), with the load average at the start.
 *
 *   pnpm --filter @taalcut/desktop e2e:perf      builds the renderer and the test build, then the perf project
 */
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { cpus, loadavg, tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from '@playwright/test';
import { desktopDir } from './launch';
import { seedFirstRunDone } from './library-seed';
import { binaryOf, startPackaged, TEST_APP, type RunningApp } from './packaged-app';
import { measureStart, spread, startUnpackaged, type ExpectedRenderer, type StartTimes } from './perf-launch';

const electronPath = createRequire(import.meta.url)('electron') as string;
const OUT = process.env.TAALCUT_PERF_DIR ?? join(desktopDir, 'test-results', 'perf');
const WARM_RUNS = 5;

/** main's environment without the renderer override, so out/renderer is what loads. */
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    (entry): entry is [string, string] => entry[1] !== undefined && entry[0] !== 'TAALCUT_RENDERER_URL',
  ),
);

interface Series {
  readonly build: string;
  readonly renderer: ExpectedRenderer;
  readonly first: StartTimes;
  readonly warm: readonly StartTimes[];
}

/** Starts one build on `userData`; the time it was spawned is taken just before. */
type Start = (userData: string) => RunningApp;

async function series(build: string, renderer: ExpectedRenderer, start: Start): Promise<Series> {
  const userData = mkdtempSync(join(tmpdir(), 'taalcut-perf-start-'));
  const launch = () => {
    const spawnedAt = Date.now();
    return measureStart(start(userData), spawnedAt, renderer);
  };
  try {
    await seedFirstRunDone(userData);
    const first = await launch();
    const warm: StartTimes[] = [];
    for (let run = 0; run < WARM_RUNS; run += 1) warm.push(await launch());
    return { build, renderer, first, warm };
  } finally {
    rmSync(userData, { recursive: true, force: true });
  }
}

const summary = (runs: readonly StartTimes[]) => ({
  navigationMs: spread(runs.map((r) => r.navigationMs)),
  fcpMs: spread(runs.map((r) => r.fcpMs)),
  interactiveMs: spread(runs.map((r) => r.interactiveMs)),
});

test('cold start: spawn to first paint and to an interactive window', async () => {
  test.setTimeout(600_000);
  const load = loadavg();
  const results: Series[] = [
    await series('test build (out/)', 'app', (userData) =>
      startUnpackaged({ electron: electronPath, desktopDir, userData, env }),
    ),
  ];
  const packaged = existsSync(binaryOf(TEST_APP));
  if (packaged)
    results.push(
      await series('packaged test build (placeholder page)', 'placeholder', (userData) =>
        startPackaged(TEST_APP, { args: ['--remote-debugging-port=0'], userData, keepUserData: true, env }),
      ),
    );
  const report = {
    measuredAt: new Date().toISOString(),
    machine: { cpus: cpus().length, model: cpus()[0]?.model ?? 'unknown' },
    loadAverageAtStart: load.map((value) => Math.round(value * 10) / 10),
    loadAverageAtEnd: loadavg().map((value) => Math.round(value * 10) / 10),
    packagedBuild: packaged ? TEST_APP : 'not built (run scripts/package-e2e.mjs first)',
    series: results.map((s) => ({
      build: s.build,
      renderer: s.renderer,
      first: s.first,
      warm: s.warm,
      warmSummary: summary(s.warm),
    })),
  };
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'start.json'), `${JSON.stringify(report, null, 2)}\n`);
  for (const s of report.series) {
    console.warn(
      `[perf] ${s.build}: first launch FCP ${s.first.fcpMs} ms, interactive ${s.first.interactiveMs ?? '-'} ms; ` +
        `warm median FCP ${s.warmSummary.fcpMs?.median ?? '-'} ms, ` +
        `interactive ${s.warmSummary.interactiveMs?.median ?? '-'} ms (load ${report.loadAverageAtStart.join(' ')})`,
    );
  }
});
