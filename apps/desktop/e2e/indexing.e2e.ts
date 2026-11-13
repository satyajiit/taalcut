// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P2-L13 in the real app: a folder of footage goes in through the Library's
 * Add folder (main's open panel, answered by the test), and the jobs process
 * imports, normalises, makes previews and proxies, finds shots, analyses them,
 * identifies the spoken language and transcribes it, tracks the music's
 * beats, and embeds frames and speech, with the on-device models installed
 * from local files (component-seed.ts) and no network at all. Then the
 * Library shows the clips and answers searches by what was said (English and
 * Hindi) and by what clips look like. All the while, every socket of the
 * app's process tree is watched: none may reach past this Mac.
 *
 * The footage is generated (indexing-footage.ts): one minute of video by
 * default; TAALCUT_INDEX_BENCH=1 indexes three minutes of the same mix and
 * prints each stage's time. The indexing bench (`pnpm bench:index`,
 * tools/evals perf/bench) runs this test with TAALCUT_PERF_DIR set, a forced
 * tier and its own footage set and work folder; the nightly harness (P2-Q4)
 * keeps its budgets. Run it under the machine's video-encoder lock.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { COMPONENT_CACHE, missingComponents, seedComponents } from './component-seed';
import { ffmpegDir } from './durability-helpers';
import { addFolder, openIndexingApp, showLibrary } from './indexing-app';
import { footageUnavailable, indexFootage, type IndexFootage } from './indexing-footage';
import { reportStuckMedia } from './indexing-stalls';
import {
  describeFailures,
  describePending,
  foreignCommands,
  indexProgress,
  indexWallMs,
  openMilestones,
  stageTimings,
  storedAssets,
  vectorKinds,
} from './indexing-support';
import { watchNetwork, type NetworkWatch } from './network-watch';
import { startIndexPerf, type IndexPerf } from './perf-index';
import { shotDetectors } from './shot-model-checks';

const BENCH = process.env.TAALCUT_INDEX_BENCH === '1';
/** The bench keeps each run's app data under its own root (one folder to exclude from scanning). */
const WORK = process.env.TAALCUT_BENCH_WORK?.trim() || tmpdir();
/** vision's EMBEDDING_SPACE.indexName (EmbeddingGemma 2, q4, daa72c5). */
const VECTOR_INDEX = 'eg2_q4_daa72c5';

const ffmpeg = ffmpegDir();
const missing = missingComponents();
const noFootage = footageUnavailable(BENCH);

let app: ElectronApplication;
let page: Page;
let root = '';
let userData = '';
let footage: IndexFootage;
let network: NetworkWatch;
/** TAALCUT_PERF_DIR set: app metrics while indexing, and index-bench.json (perf-index.ts). */
let perf: IndexPerf | null = null;

test.describe.configure({ mode: 'serial' });
// A capability, not a missing file: only a Mac makes the generated library (LNX1-PKG).
test.skip(Boolean(noFootage), noFootage);

test.beforeAll(async () => {
  test.setTimeout(600_000);
  // Neither is optional: without FFmpeg or the models nothing would be indexed, so say what is missing.
  if (!ffmpeg) throw new Error('No FFmpeg build: run tools/ffmpeg/build.sh (or set TAALCUT_FFMPEG_DIR).');
  if (missing.length > 0)
    throw new Error(`Put these files in ${COMPONENT_CACHE} (TAALCUT_COMPONENT_CACHE): ${missing.join(', ')}`);
  mkdirSync(WORK, { recursive: true });
  root = realpathSync(mkdtempSync(join(WORK, 'taalcut-e2e-index-')));
  userData = join(root, 'userData');
  footage = await indexFootage(ffmpeg, BENCH);
  // The bench measures an import on a Mac whose Core ML embedder is already compiled (coreml-precompile.ts).
  const seededMs = await seedComponents(userData, COMPONENT_CACHE, { compileCoreMl: BENCH });
  console.warn(`[indexing] models installed from ${COMPONENT_CACHE} in ${seededMs} ms`);

  ({ app, page } = await openIndexingApp(userData, footage.dir));
  network = watchNetwork(app.process().pid!);
  perf = await startIndexPerf(app, userData, footage);
});

test.afterAll(async () => {
  await network?.stop();
  const pid = app?.process().pid;
  // An FFmpeg stuck in VideoToolbox must not be ended by closing the app (brief-common "VideoToolbox stalls").
  const stalls = pid === undefined ? [] : await reportStuckMedia(pid);
  if (stalls.length > 0) {
    console.warn(`[indexing] FFmpeg stuck under the app; left running, not closed: ${stalls.join(', ')}`);
    return;
  }
  await app?.close();
  if (root) rmSync(root, { recursive: true, force: true });
});

test('a folder imports and indexes in the jobs process, with no network', async () => {
  test.setTimeout(BENCH ? 3_600_000 : 900_000);
  const added = Date.now();
  await addFolder(page);

  // Every stage of every file ends done or skipped (none failed); the strip shows it moving meanwhile.
  const files = footage.files.length;
  await expect
    .poll(
      () => {
        const progress = indexProgress(userData, files);
        if (progress.failed.length > 0)
          throw new Error(`Stages failed:\n${describeFailures(progress.failed)}`);
        return progress.settled;
      },
      { timeout: BENCH ? 3_500_000 : 840_000, intervals: [2_000] },
    )
    .toBe(true)
    .catch((error: Error) => {
      throw new Error(`${error.message}\n${describePending(userData)}`, { cause: error });
    });
  const settled = Date.now();
  const elapsed = settled - added;

  // Recorded before anything is checked, so a run whose content falls short still keeps its measurement.
  const timings = stageTimings(userData);
  const vectors = vectorKinds(userData, VECTOR_INDEX);
  console.warn(
    [
      `[indexing] ${footage.videoSeconds} s of video in ${files} files: indexed ${elapsed} ms after Add folder ` +
        `(stages ran ${indexWallMs(userData)} ms first start to last finish)`,
      ...timings.map(
        (t) =>
          `  ${t.stage.padEnd(18)} runs ${String(t.runs).padStart(3)}  wall ${t.wallMs} ms  busy ${t.busyMs} ms`,
      ),
      `  vectors ${JSON.stringify(vectors)}`,
    ].join('\n'),
  );
  await perf?.finish(
    {
      videoSeconds: footage.videoSeconds,
      files,
      addedAt: added,
      settledAt: settled,
      elapsedMs: elapsed,
      stagesWallMs: indexWallMs(userData),
      stages: timings,
      vectors,
    },
    userData,
  );

  const assets = storedAssets(userData);
  expect(assets.map((asset) => asset.fileName).sort()).toEqual([...footage.files].sort());
  for (const asset of assets) {
    expect(asset.hasFacts, `${asset.fileName}: facts`).toBe(1);
    if (asset.kind === 'video') {
      expect(asset.thumbnails, `${asset.fileName}: thumbnail`).toBe(1);
      expect(asset.shots, `${asset.fileName}: shots`).toBeGreaterThan(0);
      expect(asset.analysed, `${asset.fileName}: analysed shots`).toBe(asset.shots);
    }
  }
  for (const { file, language } of footage.spoken) {
    const asset = assets.find((stored) => stored.fileName === file);
    expect(asset?.transcriptLanguage?.split('-')[0], `${file}: transcript language`).toBe(language);
    expect(asset?.transcriptSegments, `${file}: transcript segments`).toBeGreaterThan(0);
  }
  expect(vectors.frame ?? 0, JSON.stringify(vectors)).toBeGreaterThan(0);
  expect(vectors.transcript ?? 0, JSON.stringify(vectors)).toBeGreaterThan(0);
  // TransNetV2 decided every file's shots, from its own process (IX2-S2): no scdet fallback. On a Mac it ran on
  // Core ML in the helper (IX2-S10), not the ONNX process.
  const shots = shotDetectors(userData);
  expect(Object.keys(shots.detectors), JSON.stringify(shots)).toEqual(['model']);
  if (process.platform === 'darwin')
    expect(Object.keys(shots.backends), JSON.stringify(shots)).toEqual(['coreml']);
  expect(
    Object.keys(shots.cuts).filter((method) => method !== 'model'),
    JSON.stringify(shots),
  ).toEqual([]);
  // Both finish lines are stored for every file, searchable no later than complete (IX-R1; a pipeline tick late).
  await expect.poll(() => openMilestones(userData), { timeout: 15_000 }).toEqual([]);

  // Input from outside the test while it indexed may have left the window elsewhere (IX-B5).
  warnForeignInput();
  await showLibrary(page);
  // The Library shows every file, with its picture.
  await expect(page.locator('[data-slot="clip-tile"]')).toHaveCount(files, { timeout: 30_000 });
  const pictures = page.locator('[data-slot="clip-tile"] img');
  await expect
    .poll(() =>
      pictures.evaluateAll((imgs) => imgs.filter((img) => (img as HTMLImageElement).naturalWidth > 0).length),
    )
    .toBeGreaterThan(0);
});

/** Says when commands the test did not issue were run (a person or another agent at this window). */
function warnForeignInput(): void {
  const foreign = foreignCommands(userData);
  if (foreign.length > 0)
    console.warn(
      `[indexing] input from outside the test: ${foreign.map((c) => `${c.name} (${c.source})`).join(', ')}`,
    );
}

/** Types a query into the Library's search and waits for the first hit; returns the time it took. */
async function search(query: string): Promise<number> {
  const box = page.getByRole('searchbox', { name: 'Search your clips' });
  await box.fill(query);
  const asked = Date.now();
  await box.press('Enter');
  await expect(
    page.getByRole('list', { name: 'Results' }).locator('[data-slot="search-hit"]').first(),
  ).toBeVisible({
    timeout: 30_000,
  });
  return Date.now() - asked;
}

test('search answers by speech in English and Hindi and by looks, on this Mac only', async () => {
  test.setTimeout(180_000);
  warnForeignInput();
  await showLibrary(page);
  const results = page.getByRole('list', { name: 'Results' });
  const times: number[] = [];

  for (const [index, { file, probe }] of footage.spoken.entries()) {
    times.push(await search(probe));
    await expect(results.locator('[data-slot="search-hit"]').first()).toContainText(file);
    if (index === 0)
      await expect(page.getByText('Matching words only for now.', { exact: false })).toHaveCount(0);
  }

  // No word of this is in any file name or transcript: only the frame vectors can answer it.
  times.push(await search(footage.looks));
  await expect(results.getByText('Looks like it').first()).toBeVisible();

  // The second time a query runs, its embedding is cached: the search itself.
  const first = footage.spoken[0];
  if (first) times.push(await search(first.probe));
  console.warn(
    `[indexing] search in the app, Enter to first hit: ${times.map((ms) => `${ms} ms`).join(', ')}`,
  );

  await network.stop();
  expect(network.checks()).toBeGreaterThan(10);
  // Utility processes are told apart by name (Taalcut jobs, agent, ...): Electron knows which pid is which.
  const names = new Map(
    await app.evaluate(({ app: electron }) =>
      electron.getAppMetrics().map((m) => [m.pid, m.name ?? m.serviceName ?? m.type] as const),
    ),
  );
  const leaks = network.leaks().map((leak) => ({ ...leak, service: names.get(leak.pid) ?? 'gone' }));
  expect(leaks, 'sockets that reached past this Mac').toEqual([]);
});
