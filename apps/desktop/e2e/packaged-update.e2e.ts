// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P1-B4 and anti-rollback (P1-B5 step 1): version N (the test build, 0.0.0)
 * checks a private generic feed served on loopback. Each test updates a
 * clone of N, so release/test is never changed.
 *
 *   genuine N+1   Developer ID: 'verified' (newer, same team), Squirrel.Mac
 *                 'staged', and quitting installs 0.0.1 in place.
 *                 Ad-hoc: 'rejected' (desktop.update_untrusted_signer): an
 *                 ad-hoc app has no team, so it accepts no update.
 *   rollback      the feed claims 0.0.2 but serves N itself, with a correct
 *                 sha512: 'rejected' (desktop.update_not_newer).
 *   foreign       N+1 re-signed by someone else (ad-hoc here):
 *                 'rejected' (desktop.update_untrusted_signer).
 * A rejected update never reaches Squirrel and the bundle stays at 0.0.0.
 *
 * Channels (P2-X6): package-e2e also builds 0.0.0-alpha.1 (the client) and
 * 0.0.0-alpha.2. A client on --taalcut-update-channel=alpha moves alpha.1 to
 * alpha.2 from alpha-mac.yml. An internal client does not read that file.
 * An older alpha build is not downloaded (allowDowngrade stays false).
 *
 * Signed channel files (security review SB-19): every feed here is signed with the e2e test key, which the test
 * builds trust. A channel file signed with another key, changed after signing, or without a signature is refused
 * before anything is downloaded.
 *
 *   TAALCUT_MAC_IDENTITY="Developer ID Application: …" pnpm --filter @taalcut/desktop e2e:update
 */
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import {
  assertPackaged,
  PACKAGED_UNAVAILABLE,
  startPackaged,
  TEST_APP,
  UPDATE_FEED_DIR,
  waitForStderr,
} from './packaged-app';
import { stopGuards } from './update-beta-support';
import { shipItDiagnostics, trackGuardProfile } from './update-processes';
import {
  bundleVersion,
  clearUpdateCaches,
  signChannelFile,
  startFeed,
  unpack,
  updateEvents,
  writeFeed,
  type LoggedUpdateEvent,
} from './update-feed';

const developerId = Boolean(process.env.TAALCUT_MAC_IDENTITY?.trim());
const N_PLUS_1_ZIP = join(UPDATE_FEED_DIR, 'Taalcut-0.0.1-arm64-mac.zip');
const ALPHA_CLIENT = join(UPDATE_FEED_DIR, '..', 'alpha', 'mac-arm64', 'Taalcut.app');
const ALPHA_NEXT = join(UPDATE_FEED_DIR, '..', 'alpha-next', 'mac-arm64', 'Taalcut.app');
/** N+1 as built, unpacked once from its feed zip (the hostile feeds below serve it). */
const N_PLUS_1_APP = (() => {
  let app: string | undefined;
  return () => (app ??= unpack(N_PLUS_1_ZIP, join(scratch, 'n-plus-1')));
})();
let scratch: string;

test.skip(Boolean(PACKAGED_UNAVAILABLE), PACKAGED_UNAVAILABLE);
test.describe.configure({ mode: 'serial' });

test.beforeAll(() => {
  assertPackaged(TEST_APP);
  if (!existsSync(join(UPDATE_FEED_DIR, 'latest-mac.yml'))) {
    throw new Error(
      `${UPDATE_FEED_DIR}/latest-mac.yml not found. Run: pnpm --filter @taalcut/desktop e2e:update`,
    );
  }
  // The real path: the guard's command line names the profile as main sees it (/var is /private/var).
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'taalcut-update-')));
  // electron-builder wrote N+1's channel file; the release scripts sign it, as publish-release.yml does.
  signChannelFile(join(UPDATE_FEED_DIR, 'latest-mac.yml'));
});

test.beforeEach(() => clearUpdateCaches());
test.afterEach(async () => {
  const info = test.info();
  if (info.status !== info.expectedStatus) {
    await info.attach('native-installer.log', { body: shipItDiagnostics(), contentType: 'text/plain' });
  }
});

test.afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
  clearUpdateCaches();
});

interface Run {
  readonly clone: string;
  readonly events: LoggedUpdateEvent[];
  readonly requests: string[];
  readonly quit: () => Promise<void>;
}

interface RunOptions {
  /** --taalcut-update-channel. Omitted: the baked channel (Phase 1, none). */
  readonly channel?: string;
  /** App to clone. Default: the 0.0.0 test build. */
  readonly app?: string;
  /** CFBundleShortVersionString the clone must already have. */
  readonly version?: string;
  /** Event types that end the wait. Default: staged, rejected or error. */
  readonly until?: string;
}

/** Starts a clone against `feedDir` and waits until the update settles. */
async function runUpdate(name: string, feedDir: string, options: RunOptions = {}): Promise<Run> {
  const feed = await startFeed(feedDir);
  const clone = join(scratch, name, 'Taalcut.app');
  mkdirSync(join(scratch, name), { recursive: true });
  execFileSync('cp', ['-cR', options.app ?? TEST_APP, clone]);
  expect(bundleVersion(clone)).toBe(options.version ?? '0.0.0');
  const args = [`--taalcut-update-feed=${feed.url}`];
  if (options.channel) args.push(`--taalcut-update-channel=${options.channel}`);
  const userData = join(scratch, name, 'profile');
  trackGuardProfile(userData);
  const app = startPackaged(clone, { args, userData });
  const until = options.until ?? 'staged|rejected|error';
  try {
    await waitForStderr(app, (stderr) => new RegExp(`"type":"(${until})"`).test(stderr), 120_000);
    // P3-B9: once Squirrel staged it, main prepares the rollback (a clone of the app in the profile) before the
    // quit that installs it; quitting earlier would leave that copy half made.
    if (/"type":"staged"/.test(app.stderr())) {
      await waitForStderr(
        app,
        (stderr) => /\[update\] (rollback to \S+ prepared|no rollback for)/.test(stderr),
        60_000,
      );
    }
  } catch (error) {
    await app.stop();
    feed.server.close();
    throw error;
  }
  const events = updateEvents(app.stderr());
  test.info().annotations.push({ type: 'update events', description: events.map((e) => e.type).join(' → ') });
  return {
    clone,
    events,
    requests: feed.requests,
    async quit() {
      app.child.kill('SIGTERM');
      await app.exited;
      // A staged update started the update guard at quit (P3-B9); it would wait for a launch that never comes,
      // writing its log into the profile stop() removes.
      stopGuards(userData);
      await app.stop();
      feed.server.close();
    },
  };
}

function rejection(events: readonly LoggedUpdateEvent[]): {
  code?: string;
  params?: Record<string, unknown>;
} {
  return (events.find((event) => event.type === 'rejected')?.error ?? {}) as {
    code?: string;
    params?: Record<string, unknown>;
  };
}

/** A rejected update is never staged, and quitting leaves the clone's version in place. */
async function expectNotInstalled(run: Run, version = '0.0.0'): Promise<void> {
  expect(run.events.map((event) => event.type)).not.toContain('staged');
  await run.quit();
  await new Promise((resolve) => setTimeout(resolve, 3_000));
  expect(bundleVersion(run.clone)).toBe(version);
}

function assertAlphaBuilds(): void {
  for (const app of [ALPHA_CLIENT, ALPHA_NEXT]) {
    if (!existsSync(join(app, 'Contents', 'MacOS', 'Taalcut'))) {
      throw new Error(`${app} not found. Run: pnpm --filter @taalcut/desktop e2e:update`);
    }
  }
}

test('genuine N+1: found, downloaded and verified, then staged and installed (Developer ID) or refused (ad-hoc)', async () => {
  test.setTimeout(240_000);
  const run = await runUpdate('genuine', UPDATE_FEED_DIR);
  expect(run.events[0]).toMatchObject({ type: 'checking' });
  expect(run.events).toContainEqual({ type: 'available', version: '0.0.1' });
  // electron-updater has the zip and its sha512 matched latest-mac.yml.
  expect(run.events).toContainEqual({ type: 'downloaded', version: '0.0.1' });
  expect(run.requests).toContainEqual('GET /latest-mac.yml');
  expect(run.requests).toContainEqual('GET /Taalcut-0.0.1-arm64-mac.zip');

  if (!developerId) {
    // An ad-hoc app has no team ID, so no update can be signed by its team.
    expect(rejection(run.events), JSON.stringify(run.events)).toMatchObject({
      code: 'desktop.update_untrusted_signer',
      params: { team: 'none', expected: 'none' },
    });
    await expectNotInstalled(run);
    return;
  }

  expect(run.events).toContainEqual({ type: 'verified', version: '0.0.1', team: expect.any(String) });
  expect(run.events.map((event) => event.type)).toContain('staged');
  // Squirrel.Mac's ShipIt installs the staged bundle once the app quits.
  await run.quit();
  await expect.poll(() => bundleVersion(run.clone), { timeout: 60_000 }).toBe('0.0.1');
  // What was swapped in is N+1 as built: still valid, still our Developer ID.
  execFileSync('codesign', ['--verify', '--deep', '--strict', run.clone]);
});

test('rollback: a feed that labels N itself as 0.0.2 is refused as not newer', async () => {
  test.setTimeout(240_000);
  const feedDir = join(scratch, 'rollback-feed');
  writeFeed(feedDir, TEST_APP, '0.0.2');
  const run = await runUpdate('rollback', feedDir);
  expect(run.events).toContainEqual({ type: 'downloaded', version: '0.0.2' });
  expect(rejection(run.events), JSON.stringify(run.events)).toMatchObject({
    code: 'desktop.update_not_newer',
    params: { version: '0.0.0', running: '0.0.0' },
  });
  await expectNotInstalled(run);
});

test("foreign signer: N+1 signed by someone else is refused as not our team's", async () => {
  test.setTimeout(240_000);
  const foreign = unpack(N_PLUS_1_ZIP, join(scratch, 'foreign-app'));
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', foreign]);
  const feedDir = join(scratch, 'foreign-feed');
  writeFeed(feedDir, foreign, '0.0.1');
  const run = await runUpdate('foreign', feedDir);
  expect(run.events).toContainEqual({ type: 'downloaded', version: '0.0.1' });
  expect(rejection(run.events), JSON.stringify(run.events)).toMatchObject({
    code: 'desktop.update_untrusted_signer',
    params: { team: 'none', expected: developerId ? expect.stringMatching(/^[A-Z0-9]{10}$/) : 'none' },
  });
  await expectNotInstalled(run);
});

test('alpha channel: alpha.1 takes alpha.2 from alpha-mac.yml (staged, then quit installs)', async () => {
  test.setTimeout(240_000);
  assertAlphaBuilds();
  const feedDir = join(scratch, 'alpha-feed');
  writeFeed(feedDir, ALPHA_NEXT, '0.0.0-alpha.2', 'alpha');
  const run = await runUpdate('alpha', feedDir, {
    channel: 'alpha',
    app: ALPHA_CLIENT,
    version: '0.0.0-alpha.1',
  });
  expect(run.requests).toContainEqual('GET /alpha-mac.yml');
  expect(run.requests).not.toContainEqual('GET /latest-mac.yml');
  expect(run.events).toContainEqual({ type: 'available', version: '0.0.0-alpha.2' });
  expect(run.events).toContainEqual({ type: 'downloaded', version: '0.0.0-alpha.2' });
  expect(run.requests).toContainEqual('GET /Taalcut-0.0.0-alpha.2-arm64-mac.zip');

  if (!developerId) {
    expect(rejection(run.events), JSON.stringify(run.events)).toMatchObject({
      code: 'desktop.update_untrusted_signer',
      params: { team: 'none', expected: 'none' },
    });
    await expectNotInstalled(run, '0.0.0-alpha.1');
    return;
  }

  expect(run.events).toContainEqual({ type: 'verified', version: '0.0.0-alpha.2', team: expect.any(String) });
  expect(run.events.map((event) => event.type)).toContain('staged');
  await run.quit();
  await expect.poll(() => bundleVersion(run.clone), { timeout: 60_000 }).toBe('0.0.0-alpha.2');
  execFileSync('codesign', ['--verify', '--deep', '--strict', run.clone]);
});

test('internal channel does not take the alpha feed', async () => {
  test.setTimeout(240_000);
  assertAlphaBuilds();
  const feedDir = join(scratch, 'alpha-only-feed');
  writeFeed(feedDir, ALPHA_NEXT, '0.0.0-alpha.2', 'alpha');
  const run = await runUpdate('internal', feedDir, {
    channel: 'internal',
    app: ALPHA_CLIENT,
    version: '0.0.0-alpha.1',
  });
  expect(run.requests).toContainEqual('GET /internal-mac.yml');
  expect(run.requests).not.toContainEqual('GET /alpha-mac.yml');
  expect(run.requests.some((request) => request.endsWith('.zip'))).toBe(false);
  expect(run.events.map((event) => event.type)).toContain('error');
  await expectNotInstalled(run, '0.0.0-alpha.1');
});

test('allowDowngrade stays false: an older alpha build is not downloaded', async () => {
  test.setTimeout(240_000);
  assertAlphaBuilds();
  const feedDir = join(scratch, 'alpha-old-feed');
  writeFeed(feedDir, ALPHA_CLIENT, '0.0.0-alpha.0', 'alpha');
  const run = await runUpdate('downgrade', feedDir, {
    channel: 'alpha',
    app: ALPHA_CLIENT,
    version: '0.0.0-alpha.1',
    until: 'not-available|downloaded|staged|rejected|error',
  });
  expect(run.requests).toContainEqual('GET /alpha-mac.yml');
  expect(run.requests.some((request) => request.endsWith('.zip'))).toBe(false);
  expect(run.events).toContainEqual({ type: 'not-available', version: '0.0.0-alpha.0' });
  expect(run.events.map((event) => event.type)).not.toContain('staged');
  await expectNotInstalled(run, '0.0.0-alpha.1');
});

/** Nothing was offered or fetched beyond the channel file and its signature. */
function refusedBeforeDownload(run: Run, code: string): void {
  expect(rejection(run.events), JSON.stringify(run.events)).toMatchObject({ code });
  expect(run.requests).toContainEqual('GET /latest-mac.yml.sig');
  expect(run.requests.some((request) => request.endsWith('.zip'))).toBe(false);
  expect(run.events.map((event) => event.type)).not.toContain('available');
}

test('signed channel files: one signed with another key is refused before anything is downloaded', async () => {
  test.setTimeout(240_000);
  const feedDir = join(scratch, 'foreign-key-feed');
  writeFeed(feedDir, N_PLUS_1_APP(), '0.0.1');
  const { privateKey } = generateKeyPairSync('ed25519');
  signChannelFile(
    join(feedDir, 'latest-mac.yml'),
    privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
  );
  const run = await runUpdate('foreign-key', feedDir);
  refusedBeforeDownload(run, 'desktop.update_manifest_untrusted');
  await expectNotInstalled(run);
});

test('signed channel files: one changed after signing, or with no signature, is refused before download', async () => {
  test.setTimeout(240_000);
  const feedDir = join(scratch, 'tampered-feed');
  writeFeed(feedDir, N_PLUS_1_APP(), '0.0.1');
  const yml = join(feedDir, 'latest-mac.yml');
  writeFileSync(yml, readFileSync(yml, 'utf8').replace('version: 0.0.1', 'version: 0.0.2'));
  const tampered = await runUpdate('tampered', feedDir);
  refusedBeforeDownload(tampered, 'desktop.update_manifest_mismatch');
  await expectNotInstalled(tampered);

  rmSync(`${yml}.sig`);
  const unsigned = await runUpdate('unsigned', feedDir);
  refusedBeforeDownload(unsigned, 'desktop.update_manifest_missing');
  await expectNotInstalled(unsigned);
});
