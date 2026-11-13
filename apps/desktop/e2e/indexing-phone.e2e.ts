// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P2-L3 + P2-L13 in the real app: a phone sends footage over Wi-Fi and it is
 * indexed exactly like a folder's. The Library's "From your phone" screen
 * opens the hand-off (the lan process listens while it is open); the test is
 * the phone: it reads the short address, setup code and PIN off the screen,
 * pairs, and uploads a clip and a photo with tus. The lan process probes each
 * upload with the app's FFmpeg and files it into the originals folder (under
 * a test home here); the jobs process indexes them with the same stages.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { COMPONENT_CACHE, missingComponents, seedComponents } from './component-seed';
import { ffmpegDir } from './durability-helpers';
import { openIndexingApp, type IndexingApp } from './indexing-app';
import { generatedLibrary, libraryUnavailable } from './indexing-library';
import { describeFailures, indexProgress, storedAssets } from './indexing-support';
import { pairPhone, uploadFile } from './phone-client';

const ffmpeg = ffmpegDir();
// A capability, not a missing file: only a Mac makes the generated library (LNX1-PKG).
const noLibrary = libraryUnavailable(0.1);
test.skip(Boolean(noLibrary), noLibrary);
let root = '';
let running: IndexingApp | undefined;

async function reachable(base: string): Promise<boolean> {
  try {
    await fetch(base, { signal: AbortSignal.timeout(3_000) });
    return true;
  } catch {
    return false;
  }
}

test.afterAll(async () => {
  await running?.app.close().catch(() => undefined);
  if (root) rmSync(root, { recursive: true, force: true });
});

test('a phone upload over Wi-Fi is imported and indexed like a folder', async () => {
  test.setTimeout(900_000);
  if (!ffmpeg) throw new Error('No FFmpeg build: run tools/ffmpeg/build.sh (or set TAALCUT_FFMPEG_DIR).');
  const missing = missingComponents();
  if (missing.length > 0)
    throw new Error(`Put these files in ${COMPONENT_CACHE} (TAALCUT_COMPONENT_CACHE): ${missing.join(', ')}`);
  root = realpathSync(mkdtempSync(join(tmpdir(), 'taalcut-e2e-index-phone-')));
  const userData = join(root, 'userData');
  const home = join(root, 'home');
  mkdirSync(home, { recursive: true });
  const library = await generatedLibrary(ffmpeg, 0.1);
  await seedComponents(userData);
  running = await openIndexingApp(userData, library.dir, { HOME: home });
  const { page } = running;

  await page.getByRole('link', { name: 'Library' }).click();
  await page.getByRole('link', { name: 'From your phone' }).click();
  const fallback = page.locator('p', { hasText: 'Camera won’t scan?' });
  await expect(fallback).toBeVisible({ timeout: 30_000 });
  const [address, code] = await fallback.locator('span[translate="no"]').allInnerTexts();
  // The digits as shown (the PIN's screen-reader copy, "PIN 7 2 3 …", is beside them in the same element).
  const pin = (await page.locator('[data-slot="pin"] [translate="no"]').innerText()).replace(/\D/g, '');
  expect(pin).toHaveLength(6);
  const base = /^https?:\/\//.test(address ?? '') ? address! : `http://${address}`;
  // The phone's side of this test runs on the Mac itself. Some Macs can't open a connection to their own
  // Wi-Fi address (a VPN interface, or Local Network access denied to the test runner); there the
  // device lab is the check (gate criterion 7), so say so instead of failing on the network.
  test.skip(
    !(await reachable(base)),
    `This Mac can't reach its own Wi-Fi address (${base}): run it in the device lab.`,
  );

  const credential = await pairPhone(base, (code ?? '').replace(/\s/g, ''), pin);
  const sent = ['rooftop-portrait-h264.mp4', 'street-photo.jpg'];
  await uploadFile(base, credential, join(library.dir, sent[0]!), 'video/mp4');
  await uploadFile(base, credential, join(library.dir, sent[1]!), 'image/jpeg');

  // Filed into the originals folder and indexed by the same stages as a folder's files.
  await expect
    .poll(
      () => {
        const progress = indexProgress(userData, sent.length);
        if (progress.failed.length > 0)
          throw new Error(`Stages failed:\n${describeFailures(progress.failed)}`);
        return progress.settled;
      },
      { timeout: 840_000, intervals: [2_000] },
    )
    .toBe(true);
  const assets = storedAssets(userData);
  expect(assets.map((asset) => asset.fileName).sort()).toEqual([...sent].sort());
  const clip = assets.find((asset) => asset.fileName === sent[0])!;
  expect(clip).toMatchObject({ hasFacts: 1, thumbnails: 1, transcriptLanguage: 'hi' });
  expect(clip.shots).toBeGreaterThan(0);
  expect(clip.analysed).toBe(clip.shots);
  const originals = join(home, 'Movies', 'Taalcut', 'Originals');
  expect(existsSync(originals) && readdirSync(originals).length).toBeTruthy();
  // The screen shows both files done.
  await expect(page.getByText(sent[0]!, { exact: false }).first()).toBeVisible();
});
