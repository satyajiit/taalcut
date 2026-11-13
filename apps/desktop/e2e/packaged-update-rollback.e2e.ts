// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Gate criterion 3 (P3-B9): the beta channel updates an installed build to a new version and recovers from a
 * forced failure. Developer ID test builds (scripts/package-e2e.mjs --update), a feed published by the release
 * workflows' own scripts (scripts/rollout, --dir), the real update guard (Resources/bin/taalcut update-guard).
 *
 *   healthy    beta.1 takes beta.2: prepared (rollback copy, pending.json, guard) when staged, the guard starts
 *              at quit, ShipIt installs, beta.2's first launch writes healthy-0.0.0-beta.2 and the notes are in
 *              the app's language; the launch after that removes the rollback copy
 *   broken     beta.1 takes a beta.2 that exits before its window (TAALCUT_TEST_UPDATE_FAULT): after two failed
 *              launches the guard puts beta.1 back (rolled-back.json says why), About's state carries the
 *              rollback, the project made before the update is intact, beta.2 is never downloaded again, and
 *              beta.3 (good) installs
 *
 *   TAALCUT_MAC_IDENTITY="Developer ID Application: …" pnpm --filter @taalcut/desktop e2e:update
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
  startRangeFeed,
  untilLog,
  untilUpdate,
  guardRunning,
  stopGuards,
  versionOf,
  type BetaRun,
  type RangeFeed,
} from './update-beta-support';
import { clearUpdateCaches } from './update-feed';

const developerId = Boolean(process.env.TAALCUT_MAC_IDENTITY?.trim());
let scratch: string;
const feeds: RangeFeed[] = [];

test.skip(Boolean(PACKAGED_UNAVAILABLE), PACKAGED_UNAVAILABLE);
test.describe.configure({ mode: 'serial' });

test.beforeAll(() => {
  assertBetaBuilds();
  // The real path: main's appPath comes from process.execPath, which has /var resolved to /private/var.
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'taalcut-beta-update-')));
});
test.beforeEach(() => clearUpdateCaches());
// A case that failed half-way leaves no app running.
test.afterEach(() => killLeftoverApps());
test.afterAll(async () => {
  for (const feed of feeds.splice(0)) await feed.close();
  // A guard still waiting for a launch that will never come.
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

const updates = (userData: string) => join(userData, 'updates');
const json = (file: string) => JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;

/** Takes the offered update and quits so ShipIt installs it, as a person would by quitting. */
async function takeUpdate(run: BetaRun, from: string, to: string): Promise<void> {
  const events = await untilUpdate(run, 'staged|rejected|error');
  expect(events, JSON.stringify(events)).toContainEqual({
    type: 'verified',
    version: to,
    team: expect.any(String),
  });
  expect(events.map((event) => event.type)).toContain('staged');
  await untilLog(run, new RegExp(`\\[update\\] rollback to ${from.replaceAll('.', '\\.')} prepared`));
  await run.quit();
  // Started from will-quit, detached: it outlives the app and waits for ShipIt.
  await eventually(
    () => guardRunning(run.userData),
    10_000,
    'the update guard',
    () => diagnose(run),
  );
}

test('healthy: beta.1 → beta.2, healthy marker, notes in Hindi, the rollback copy removed at the next launch', async () => {
  test.skip(!developerId, 'Squirrel installs only an update signed by the same Developer ID team');
  test.setTimeout(420_000);
  const { feed, target } = await betaFeed('healthy');
  publishBeta(target, '0.0.0-beta.2', 100, { en: '- Faster export', hi: '- तेज़ निर्यात' });
  const app = cloneBeta('0.0.0-beta.1', join(scratch, 'healthy', 'Taalcut.app'));
  const userData = join(scratch, 'healthy', 'profile');

  const first = launchBeta(app, userData, feed, ['--lang=hi', '--remote-debugging-port=0']);
  await untilUpdate(first, 'staged|rejected|error');
  expect(feed.requests).toContainEqual('GET /channel-beta/beta-mac.yml');
  expect(feed.requests).toContainEqual('GET /v0.0.0-beta.2/Taalcut-0.0.0-beta.2-arm64-mac.zip');
  const page = await connectToPage(await devToolsPort(first.app), 'app://');
  const state = await page.evaluate(
    async () => (await window.taalcutProbe?.client)?.updates.state(),
    undefined,
  );
  page.close();
  expect(state).toMatchObject({
    channel: 'beta',
    choice: 'beta',
    status: {
      kind: 'ready',
      version: '0.0.0-beta.2',
      notes: '- तेज़ निर्यात',
      releaseDate: expect.any(Number),
    },
  });
  await takeUpdate(first, '0.0.0-beta.1', '0.0.0-beta.2');
  expect(json(join(updates(userData), 'pending.json'))).toMatchObject({
    v: 1,
    from: '0.0.0-beta.1',
    to: '0.0.0-beta.2',
    appPath: app,
    launchAttempts: 0,
    channel: 'beta',
  });
  expect(existsSync(join(updates(userData), 'rollback', 'Taalcut-0.0.0-beta.1.app'))).toBe(true);
  await eventually(() => versionOf(app) === '0.0.0-beta.2', 90_000, 'ShipIt to install beta.2');

  const second = launchBeta(app, userData, feed);
  await untilLog(second, /\[update\] 0\.0\.0-beta\.2 is healthy/, 90_000);
  expect(existsSync(join(updates(userData), 'healthy-0.0.0-beta.2'))).toBe(true);
  await untilUpdate(second, 'not-available|error');
  await second.quit();

  const third = launchBeta(app, userData, feed);
  await untilUpdate(third, 'not-available|error');
  await eventually(
    () =>
      !existsSync(join(updates(userData), 'rollback')) &&
      !existsSync(join(updates(userData), 'pending.json')),
    30_000,
    'the rollback copy and pending.json to go',
  );
  await third.quit();
  execFileSync('codesign', ['--verify', '--deep', '--strict', app]);
});

test('broken: two failed launches of beta.2, the guard restores beta.1, beta.2 is blocked, beta.3 installs', async () => {
  test.skip(!developerId, 'Squirrel installs only an update signed by the same Developer ID team');
  test.setTimeout(600_000);
  const { feed, target } = await betaFeed('broken');
  publishBeta(target, '0.0.0-beta.2-broken', 100);
  const app = cloneBeta('0.0.0-beta.1', join(scratch, 'broken', 'Taalcut.app'));
  const userData = join(scratch, 'broken', 'profile');

  // The person's work before the update: a project, which must still be there after the rollback.
  const before = launchBeta(app, userData, feed, ['--remote-debugging-port=0']);
  const seeded = await connectToPage(await devToolsPort(before.app), 'app://');
  const project = await seeded.evaluate(async (name) => {
    const rpc = await window.taalcutProbe?.client;
    if (!rpc) throw new Error('no client');
    await rpc.commands.dispatch({ name: 'project.create', payload: { name }, source: 'ui' });
    return (await rpc.projects.list({})).items.find((item) => item.name === name);
  }, 'Kept through a rollback');
  seeded.close();
  expect(project).toMatchObject({ name: 'Kept through a rollback' });
  await takeUpdate(before, '0.0.0-beta.1', '0.0.0-beta.2');
  await eventually(() => versionOf(app) === '0.0.0-beta.2', 90_000, 'ShipIt to install the broken beta.2');

  for (const attempt of [1, 2]) {
    const failed = launchBeta(app, userData, feed);
    expect(await failed.app.exitWithin(30_000), `launch ${attempt}`).toBe(1);
    expect(failed.app.stderr()).toContain('[update] test fault: exit-before-ready');
    await failed.app.stop();
    // The guard polls every 500 ms; give it a moment to see this launch end.
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  await eventually(() => versionOf(app) === '0.0.0-beta.1', 60_000, 'the guard to put beta.1 back');
  const rolledBack = join(updates(userData), 'rolled-back.json');
  await eventually(() => existsSync(rolledBack), 10_000, 'rolled-back.json');
  expect(json(rolledBack)).toMatchObject({
    v: 1,
    from: '0.0.0-beta.1',
    to: '0.0.0-beta.2',
    reason: 'launch-failed',
  });
  expect(existsSync(join(updates(userData), 'failed', 'Taalcut-0.0.0-beta.2.app'))).toBe(true);
  execFileSync('codesign', ['--verify', '--deep', '--strict', app]);

  // Back on beta.1: the notice, and beta.2 (still what the channel serves) is refused before any download.
  const requestsBefore = feed.requests.length;
  const back = launchBeta(app, userData, feed, ['--remote-debugging-port=0']);
  await untilLog(back, /\[update\] last rollback: \{"from":"0\.0\.0-beta\.1","to":"0\.0\.0-beta\.2"/);
  const events = await untilUpdate(back, 'not-available|available|error');
  expect(events).toContainEqual({ type: 'not-available', version: '0.0.0-beta.2' });
  expect(feed.requests.slice(requestsBefore).some((request) => request.includes('.zip'))).toBe(false);
  const page = await connectToPage(await devToolsPort(back.app), 'app://');
  const [state, kept] = await page.evaluate(async () => {
    const rpc = await window.taalcutProbe?.client;
    return [await rpc?.updates.state(), (await rpc?.projects.list({}))?.items] as const;
  }, undefined);
  page.close();
  expect(kept).toContainEqual(project);
  expect(state).toMatchObject({
    version: '0.0.0-beta.1',
    lastRollback: { from: '0.0.0-beta.1', to: '0.0.0-beta.2' },
  });
  await back.quit();

  // Fixing forward: a higher version installs.
  publishBeta(target, '0.0.0-beta.3', 100);
  await takeUpdate(launchBeta(app, userData, feed), '0.0.0-beta.1', '0.0.0-beta.3');
  await eventually(() => versionOf(app) === '0.0.0-beta.3', 90_000, 'ShipIt to install beta.3');
  const fixed = launchBeta(app, userData, feed);
  await untilLog(fixed, /\[update\] 0\.0\.0-beta\.3 is healthy/, 90_000);
  await fixed.quit();
});
