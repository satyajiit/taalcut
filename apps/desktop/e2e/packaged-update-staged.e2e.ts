// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P3-B9: a broken build at 10% is pulled and clients stay on the last good version; delta updates. Developer ID
 * test builds (scripts/package-e2e.mjs --update) against a feed published by scripts/rollout (--dir).
 *
 *   staged 10%   two installs whose .updaterId fall either side of 10%: only the one inside takes beta.2;
 *                pull-release's script re-points the channel to beta.1 and the other stays on beta.1; beta.3 at
 *                100% then reaches both
 *   delta        after a full first update, the next one fetches only changed blocks (the feed counts the
 *                bytes) and still passes our verification; with beta.3's blockmap corrupted, another beta.2
 *                install falls back to the full zip; notes missing in the app's language arrive in English
 *
 *   TAALCUT_MAC_IDENTITY="Developer ID Application: …" pnpm --filter @taalcut/desktop e2e:update
 */
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { connectToPage } from './cdp';
import { devToolsPort, PACKAGED_UNAVAILABLE } from './packaged-app';
import {
  assertBetaBuilds,
  cloneBeta,
  diagnose,
  eventually,
  killLeftoverApps,
  launchBeta,
  publishBeta,
  rollout,
  startRangeFeed,
  stopGuards,
  untilLog,
  untilUpdate,
  versionOf,
  type BetaRun,
  type RangeFeed,
} from './update-beta-support';
import { clearUpdateCaches } from './update-feed';

const developerId = Boolean(process.env.TAALCUT_MAC_IDENTITY?.trim());
/** electron-updater's cohort: the last four bytes of .updaterId over 0xffffffff, in when below the percentage. */
const INSIDE_10 = '8f2c4c3e-1b2a-5c3d-9e4f-000000000001';
const OUTSIDE_10 = '8f2c4c3e-1b2a-5c3d-9e4f-0000ffffffff';
/** Where electron-updater keeps the last zip it downloaded (`updaterCacheDirName`, update-feed.ts). */
const UPDATER_CACHE = join(homedir(), 'Library', 'Caches', '@taalcutdesktop-updater');
/** The last download, kept for the next differential one. */
const UPDATER_CACHE_ZIP = join(UPDATER_CACHE, 'update.zip');
let scratch: string;
const feeds: RangeFeed[] = [];

test.skip(Boolean(PACKAGED_UNAVAILABLE), PACKAGED_UNAVAILABLE);
test.describe.configure({ mode: 'serial' });

test.beforeAll(() => {
  assertBetaBuilds();
  // The real path: main's appPath comes from process.execPath, which has /var resolved to /private/var.
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'taalcut-beta-staged-')));
});
test.beforeEach(() => clearUpdateCaches());
// A case that failed half-way leaves no app running.
test.afterEach(() => killLeftoverApps());
test.afterAll(async () => {
  for (const feed of feeds.splice(0)) await feed.close();
  stopGuards(scratch);
  rmSync(scratch, { recursive: true, force: true });
  clearUpdateCaches();
});

async function betaFeed(name: string) {
  const root = join(scratch, name, 'github');
  mkdirSync(root, { recursive: true });
  const feed = await startRangeFeed(root);
  feeds.push(feed);
  return { feed, root, target: { root, base: feed.base } };
}

function profile(name: string, updaterId?: string): string {
  const dir = join(scratch, name, 'profile');
  mkdirSync(dir, { recursive: true });
  if (updaterId) writeFileSync(join(dir, '.updaterId'), updaterId);
  return dir;
}

async function installs(run: BetaRun, app: string, version: string): Promise<void> {
  const events = await untilUpdate(run, 'staged|rejected|error');
  expect(events, JSON.stringify(events)).toContainEqual({
    type: 'verified',
    version,
    team: expect.any(String),
  });
  expect(events.map((event) => event.type)).toContain('staged');
  await untilLog(run, /\[update\] rollback to .* prepared/);
  await run.quit();
  await eventually(
    () => versionOf(app) === version,
    90_000,
    `ShipIt to install ${version}`,
    () => diagnose(run),
  );
}

async function staysOn(run: BetaRun, app: string, offered: string): Promise<void> {
  const events = await untilUpdate(run, 'not-available|available|error');
  expect(events, JSON.stringify(events)).toContainEqual({ type: 'not-available', version: offered });
  expect(events.map((event) => event.type)).not.toContain('available');
  const version = versionOf(app);
  await run.quit();
  await new Promise((resolve) => setTimeout(resolve, 3_000));
  expect(versionOf(app)).toBe(version);
}

test('staged 10%: only the cohort takes beta.2; pulled, the rest stay on beta.1; beta.3 at 100% reaches both', async () => {
  test.skip(!developerId, 'Squirrel installs only an update signed by the same Developer ID team');
  test.setTimeout(900_000);
  const { feed, root, target } = await betaFeed('staged');
  publishBeta(target, '0.0.0-beta.1', 100);
  publishBeta(target, '0.0.0-beta.2', 10);
  const inside = cloneBeta('0.0.0-beta.1', join(scratch, 'inside', 'Taalcut.app'));
  const outside = cloneBeta('0.0.0-beta.1', join(scratch, 'outside', 'Taalcut.app'));
  const insideProfile = profile('inside', INSIDE_10);
  const outsideProfile = profile('outside', OUTSIDE_10);

  await installs(launchBeta(inside, insideProfile, feed), inside, '0.0.0-beta.2');
  const zipRequests = () =>
    feed.requests.filter((request) => request.includes('beta.2-arm64-mac.zip')).length;
  const before = zipRequests();
  await staysOn(launchBeta(outside, outsideProfile, feed), outside, '0.0.0-beta.2');
  expect(zipRequests()).toBe(before);

  // pull-release.yml's script: the channel goes back to beta.1's history entry.
  expect(
    rollout(root, [
      'pull',
      '--channel',
      'beta',
      '--bad-version',
      '0.0.0-beta.2',
      '--to-version',
      '0.0.0-beta.1',
      '--reason',
      'It broke the timeline on some Macs.',
    ]),
  ).toContain('channel-beta/beta-mac.yml: back to 0.0.0-beta.1');
  await staysOn(launchBeta(outside, outsideProfile, feed), outside, '0.0.0-beta.1');

  publishBeta(target, '0.0.0-beta.3', 100);
  // The cohort member is on the pulled beta.2: only a higher version moves it, and it does.
  await installs(launchBeta(inside, insideProfile, feed), inside, '0.0.0-beta.3');
  await installs(launchBeta(outside, outsideProfile, feed), outside, '0.0.0-beta.3');
});

test('delta: the second update fetches only changed blocks; a corrupted blockmap falls back to a full download', async () => {
  test.skip(!developerId, 'Squirrel installs only an update signed by the same Developer ID team');
  test.setTimeout(900_000);
  const { feed, target } = await betaFeed('delta');
  publishBeta(target, '0.0.0-beta.2', 100, { en: '- English only' });
  const app = cloneBeta('0.0.0-beta.1', join(scratch, 'delta', 'Taalcut.app'));
  const userData = profile('delta');

  // First update after an install: always the full zip (nothing cached to copy blocks from).
  const first = launchBeta(app, userData, feed, ['--lang=es', '--remote-debugging-port=0']);
  await untilUpdate(first, 'staged|rejected|error');
  expect(first.events().map((event) => event.type)).not.toContain('delta');
  const zip2 = join(target.root, 'v0.0.0-beta.2', 'Taalcut-0.0.0-beta.2-arm64-mac.zip');
  expect(feed.bytesFor('Taalcut-0.0.0-beta.2-arm64-mac.zip')).toBe(statSync(zip2).size);
  const page = await connectToPage(await devToolsPort(first.app), 'app://');
  const state = await page.evaluate(
    async () => (await window.taalcutProbe?.client)?.updates.state(),
    undefined,
  );
  page.close();
  // No Spanish notes: English.
  expect(state).toMatchObject({
    status: { kind: 'ready', version: '0.0.0-beta.2', notes: '- English only' },
  });
  await installs(first, app, '0.0.0-beta.2');
  // electron-updater keeps the last download as update.zip and copies unchanged blocks from it.
  const cachedBeta2 = join(scratch, 'delta', 'update-beta.2.zip');
  copyFileSync(UPDATER_CACHE_ZIP, cachedBeta2);

  publishBeta(target, '0.0.0-beta.3', 100);
  const second = launchBeta(app, userData, feed);
  await installs(second, app, '0.0.0-beta.3');
  expect(second.events()).toContainEqual({ type: 'delta' });
  expect(second.events()).not.toContainEqual({ type: 'delta-failed' });
  const zip3 = statSync(join(target.root, 'v0.0.0-beta.3', 'Taalcut-0.0.0-beta.3-arm64-mac.zip')).size;
  const fetched = feed.bytesFor('Taalcut-0.0.0-beta.3-arm64-mac.zip');
  test.info().annotations.push({ type: 'delta bytes', description: `${fetched} of ${zip3}` });
  expect(fetched).toBeGreaterThan(0);
  expect(fetched).toBeLessThan(zip3 / 2);

  // A corrupted blockmap: another beta.2 install, the same cached beta.2 zip, and beta.3's blockmap broken.
  // electron-updater gives up on the delta and downloads the whole zip, which still passes our checks. Its
  // pending/ folder still holds the beta.3 just installed, which it would reuse without downloading: gone.
  rmSync(join(UPDATER_CACHE, 'pending'), { recursive: true, force: true });
  copyFileSync(cachedBeta2, UPDATER_CACHE_ZIP);
  const corrupted = await betaFeed('corrupted');
  publishBeta(corrupted.target, '0.0.0-beta.2', 100);
  publishBeta(corrupted.target, '0.0.0-beta.3', 100);
  writeFileSync(
    join(corrupted.root, 'v0.0.0-beta.3', 'Taalcut-0.0.0-beta.3-arm64-mac.zip.blockmap'),
    'not a gzip blockmap',
  );
  const other = cloneBeta('0.0.0-beta.2', join(scratch, 'corrupted', 'Taalcut.app'));
  const third = launchBeta(other, profile('corrupted'), corrupted.feed);
  await installs(third, other, '0.0.0-beta.3');
  expect(third.events()).toContainEqual({ type: 'delta-failed' });
  expect(corrupted.feed.bytesFor('Taalcut-0.0.0-beta.3-arm64-mac.zip')).toBe(zip3);
});
