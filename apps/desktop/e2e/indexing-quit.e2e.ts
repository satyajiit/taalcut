// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P2-L13 "quitting mid-index resumes", at its sharpest: the app quits while language ID is running on
 * whisper-server. The job is handed back (or left for the next start to take over), never failed, and after the
 * relaunch every file's indexing settles with no stage failed.
 *
 * Found in UX2 round 4 (indexing-durability.e2e.ts failed once, after its own quit, with
 * `audio.language: audio.engine_unavailable` and no detail): at quit the jobs process disposed its container
 * newest first, so the audio runtime, made at the first audio job and so newer than the job engine, closed its
 * whisper-server pool while the engine still ran; the language call in flight came back engine_unavailable, and
 * the engine recorded a failure that the next start kept.
 */
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { z } from 'zod';
import { COMPONENT_CACHE, missingComponents, seedComponents } from './component-seed';
import { ffmpegDir, whisperServersOf } from './durability-helpers';
import { addFolder, openIndexingApp, type IndexingApp } from './indexing-app';
import { generatedLibrary, libraryUnavailable } from './indexing-library';
import { describeFailures, indexProgress } from './indexing-support';
import { libraryRows } from './library-rows';

const ffmpeg = ffmpegDir();
// A capability, not a missing file: only a Mac makes the generated library (LNX1-PKG).
const noLibrary = libraryUnavailable(0.1);
test.skip(Boolean(noLibrary), noLibrary);
let root = '';
let running: IndexingApp | undefined;

test.afterAll(async () => {
  if (running) await running.app.close();
  if (root) rmSync(root, { recursive: true, force: true });
});

const jobRow = z.object({ id: z.string(), state: z.string(), error: z.string().nullable() });
const languageJobs = (userData: string) =>
  z
    .array(jobRow)
    .parse(libraryRows(userData, "SELECT id, state, error FROM jobs WHERE kind = 'audio.identifyLanguage'"));

test('a quit while language ID runs on whisper-server hands the job back: nothing fails, all settles after', async () => {
  test.setTimeout(900_000);
  if (!ffmpeg) throw new Error('No FFmpeg build: run tools/ffmpeg/build.sh (or set TAALCUT_FFMPEG_DIR).');
  const missing = missingComponents();
  if (missing.length > 0)
    throw new Error(`Put these files in ${COMPONENT_CACHE} (TAALCUT_COMPONENT_CACHE): ${missing.join(', ')}`);
  root = realpathSync(mkdtempSync(join(tmpdir(), 'taalcut-e2e-index-quit-')));
  const userData = join(root, 'userData');
  const library = await generatedLibrary(ffmpeg, 0.1);
  await seedComponents(userData);
  running = await openIndexingApp(userData, library.dir);
  await addFolder(running.page);

  // A language job running with its whisper-server up: quit right then.
  let inFlight: string | undefined;
  await expect
    .poll(
      () => {
        inFlight = languageJobs(userData).find((row) => row.state === 'running')?.id;
        return inFlight !== undefined && whisperServersOf(userData).length > 0;
      },
      { timeout: 300_000, intervals: [50] },
    )
    .toBe(true);
  const app = running.app;
  running = undefined;
  await app.close();

  const atQuit = languageJobs(userData).find((row) => row.id === inFlight);
  expect(atQuit?.state, `the job running at the quit: ${atQuit?.error ?? 'no error'}`).not.toBe('failed');

  running = await openIndexingApp(userData, library.dir, {}, { afterQuit: true });
  await expect
    .poll(
      () => {
        const progress = indexProgress(userData, library.files.length);
        if (progress.failed.length > 0)
          throw new Error(`Stages failed:\n${describeFailures(progress.failed)}`);
        return progress.settled;
      },
      { timeout: 600_000, intervals: [500] },
    )
    .toBe(true);
  expect(languageJobs(userData).filter((row) => row.state === 'failed')).toEqual([]);
});
