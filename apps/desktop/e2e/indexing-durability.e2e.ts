// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Gate criterion 9 for import (P2-L13 "quitting mid-index resumes"): while a
 * folder is being indexed in the real app, kill -9 the jobs process; the
 * supervisor restarts it, it takes the dead process's leases over and the
 * pipeline reconciles its rows. Then quit the app mid-index and open it
 * again on the same userData. Indexing finishes with nothing lost or done
 * twice: every file is one asset, every stage that had finished before the
 * kill is untouched (same job, same finish time), no job ran twice for one
 * idempotency key, and no stage failed. No whisper-server outlives the jobs
 * process that started it, killed or quit (IX-F7), and no shot model process
 * either (IX2-S2).
 */
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { COMPONENT_CACHE, missingComponents, seedComponents } from './component-seed';
import { alive, ffmpegDir, utilityPid, whisperServersOf } from './durability-helpers';
import { addFolder, openIndexingApp, type IndexingApp } from './indexing-app';
import { generatedLibrary, libraryUnavailable } from './indexing-library';
import { shotModelPids, shotsHelpersOf } from './shot-model-checks';
import {
  assetCount,
  describeFailures,
  indexProgress,
  jobsByKey,
  stageRows,
  storedAssets,
} from './indexing-support';

const ffmpeg = ffmpegDir();
// A capability, not a missing file: only a Mac makes the generated library (LNX1-PKG).
const noLibrary = libraryUnavailable(0.1);
test.skip(Boolean(noLibrary), noLibrary);
let root = '';
let running: IndexingApp | undefined;

test.afterAll(async () => {
  await running?.app.close().catch(() => undefined);
  if (root) rmSync(root, { recursive: true, force: true });
});

/** Stage progress until `until` holds; a failed stage fails the test at once, with its detail. */
async function progressUntil(
  userData: string,
  files: number,
  until: (p: ReturnType<typeof indexProgress>) => boolean,
  timeout: number,
) {
  await expect
    .poll(
      () => {
        const progress = indexProgress(userData, files);
        if (progress.failed.length > 0)
          throw new Error(`Stages failed:\n${describeFailures(progress.failed)}`);
        return until(progress);
      },
      { timeout, intervals: [500] },
    )
    .toBe(true);
}

test('kill -9 of the jobs process and a quit mid-index: indexing resumes, nothing lost or done twice', async () => {
  test.setTimeout(1_200_000);
  if (!ffmpeg) throw new Error('No FFmpeg build: run tools/ffmpeg/build.sh (or set TAALCUT_FFMPEG_DIR).');
  const missing = missingComponents();
  if (missing.length > 0)
    throw new Error(`Put these files in ${COMPONENT_CACHE} (TAALCUT_COMPONENT_CACHE): ${missing.join(', ')}`);
  root = realpathSync(mkdtempSync(join(tmpdir(), 'taalcut-e2e-index-durable-')));
  const userData = join(root, 'userData');
  const library = await generatedLibrary(ffmpeg, 0.1);
  const files = library.files.length;
  await seedComponents(userData);

  running = await openIndexingApp(userData, library.dir);
  await addFolder(running.page);

  // Mid-index: every file is in, some stages are done and others are still to come.
  await progressUntil(userData, files, (p) => p.assets >= files && p.done >= 15 && p.active > 0, 600_000);
  const doneBeforeKill = stageRows(userData).filter((row) => row.state === 'done');

  const jobsPid = await utilityPid(running.app, 'jobs');
  expect(jobsPid).toBeDefined();
  const modelsAtKill = await shotModelPids(running.app);
  process.kill(jobsPid!, 'SIGKILL');
  await expect
    .poll(
      async () => {
        const pid = await utilityPid(running!.app, 'jobs');
        return pid !== undefined && pid !== jobsPid;
      },
      { timeout: 60_000 },
    )
    .toBe(true);
  // No whisper-server of the killed process outlives it (IX-F7): every one left belongs to the new jobs process.
  const restartedPid = await utilityPid(running.app, 'jobs');
  await expect
    .poll(() => whisperServersOf(userData).filter((server) => server.ppid !== restartedPid), {
      timeout: 15_000,
    })
    .toEqual([]);
  // Nor a shot model process of the killed one (IX2-S2): main stops it, and it ends when its port closes. Nor
  // its helper's shots service (IX2-S10): it ends when its stdin closes.
  await expect.poll(() => modelsAtKill.filter(alive), { timeout: 15_000 }).toEqual([]);
  await expect
    .poll(() => shotsHelpersOf(userData).filter((helper) => helper.ppid !== restartedPid), {
      timeout: 15_000,
    })
    .toEqual([]);
  // The restarted process picks the work up: more stages finish.
  const doneAtKill = doneBeforeKill.length;
  await progressUntil(userData, files, (p) => p.done > doneAtKill || p.active === 0, 300_000);

  // A quit while work is left, then the app again on the same library.
  const quitMidIndex = indexProgress(userData, files).active > 0;
  const modelsAtQuit = await shotModelPids(running.app);
  await running.app.close();
  await expect.poll(() => modelsAtQuit.filter(alive), { timeout: 15_000 }).toEqual([]);
  await expect.poll(() => shotsHelpersOf(userData), { timeout: 15_000 }).toEqual([]);
  // Quitting stops every whisper-server it started (IX-F7).
  await expect.poll(() => whisperServersOf(userData), { timeout: 15_000 }).toEqual([]);
  running = await openIndexingApp(userData, library.dir, {}, { afterQuit: true });
  await progressUntil(userData, files, (p) => p.settled, 600_000);
  console.warn(
    `[indexing] durability: killed jobs at ${doneAtKill} stages done; quit mid-index: ${quitMidIndex}`,
  );

  // Nothing lost: every file once.
  expect(assetCount(userData)).toBe(files);
  expect(
    storedAssets(userData)
      .map((asset) => asset.fileName)
      .sort(),
  ).toEqual([...library.files].sort());
  // Nothing done twice: finished stages kept their job and time; no idempotency key ran twice.
  const after = new Map(stageRows(userData).map((row) => [`${row.assetId}|${row.stage}`, row]));
  for (const row of doneBeforeKill) {
    const now = after.get(`${row.assetId}|${row.stage}`);
    expect(now, `${row.fileName} ${row.stage}`).toMatchObject({
      state: 'done',
      jobId: row.jobId,
      finishedAt: row.finishedAt,
    });
  }
  expect(jobsByKey(userData).filter((job) => job.runs > 1)).toEqual([]);

  // And the last quit, right after indexing settled (a server still inside its idle minute), leaves none (IX-F7).
  const modelsAtLastQuit = await shotModelPids(running.app);
  await running.app.close();
  await expect.poll(() => modelsAtLastQuit.filter(alive), { timeout: 15_000 }).toEqual([]);
  await expect.poll(() => shotsHelpersOf(userData), { timeout: 15_000 }).toEqual([]);
  running = undefined;
  await expect.poll(() => whisperServersOf(userData), { timeout: 15_000 }).toEqual([]);
});
