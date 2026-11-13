// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Local update feeds for packaged-update.e2e.ts: a generic-provider feed
 * served over loopback http, plus helpers that craft hostile feeds (an old
 * build labelled as new; a build signed by someone else) the way an attacker
 * who controls the feed host could, with a correct sha512 in latest-mac.yml.
 * A channel publishes `<channel>-mac.yml` (alpha-mac.yml) the same way.
 *
 * Every channel file is signed (security review SB-19) by the release scripts' own `sign` command with the e2e
 * test key, which every test build trusts (scripts/package-e2e.mjs). The hostile feeds above are signed too, as
 * if the key had leaked as well, so the bundle checks behind the signature stay under test.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type Server } from 'node:http';
import { homedir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { updateFeedFileName } from '../src/main/update/feed';

const releaseScript = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'scripts',
  'release.mjs',
);
let testKey: string | undefined;

/** The e2e signing key's PEM (`release.mjs test-key`): test builds trust it, release builds never do. */
export function testSigningKeyPem(): string {
  testKey ??= execFileSync(process.execPath, [releaseScript, 'test-key'], { encoding: 'utf8' });
  return testKey;
}

/** `node scripts/release.mjs <args>`, signing with `keyPem` (default: the test key) as the workflows sign. */
export function runReleaseScript(args: readonly string[], keyPem: string = testSigningKeyPem()): string {
  return execFileSync(process.execPath, [releaseScript, ...args], {
    encoding: 'utf8',
    env: { ...process.env, TAALCUT_UPDATE_SIGNING_KEY: keyPem },
  });
}

/** Writes `<file>.sig` with the release scripts' `sign` command. */
export function signChannelFile(file: string, keyPem?: string): void {
  runReleaseScript(['sign', '--file', file], keyPem);
}

export interface Feed {
  readonly server: Server;
  readonly url: string;
  readonly requests: string[];
}

/** Serves `root` and records every request. */
export async function startFeed(root: string): Promise<Feed> {
  const requests: string[] = [];
  const base = resolve(root);
  const server = createServer((request, response) => {
    const path = decodeURIComponent(new URL(request.url ?? '/', 'http://feed').pathname);
    requests.push(`${request.method} ${path}`);
    const file = resolve(base, `.${path}`);
    if (!file.startsWith(base + sep) || !existsSync(file) || statSync(file).isDirectory()) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'Content-Length': statSync(file).size });
    createReadStream(file).pipe(response);
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return { server, url: `http://127.0.0.1:${port}/`, requests };
}

/**
 * Zips `app` into `dir` and writes the channel file claiming `version`, signed with the test key.
 * No channel: latest-mac.yml. `alpha`: alpha-mac.yml. The app is zipped as
 * it is already signed (dev-signed or Developer ID); this does not re-sign.
 */
export function writeFeed(dir: string, app: string, version: string, channel?: string): string {
  mkdirSync(dir, { recursive: true });
  const name = `Taalcut-${version}-arm64-mac.zip`;
  const zip = join(dir, name);
  execFileSync('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, zip]);
  const sha512 = createHash('sha512').update(readFileSync(zip)).digest('base64');
  const size = statSync(zip).size;
  const yml = join(dir, updateFeedFileName(channel));
  writeFileSync(
    yml,
    [
      `version: ${version}`,
      'files:',
      `  - url: ${name}`,
      `    sha512: ${sha512}`,
      `    size: ${size}`,
      `path: ${name}`,
      `sha512: ${sha512}`,
      "releaseDate: '2026-10-12T00:00:00.000Z'",
      '',
    ].join('\n'),
  );
  signChannelFile(yml);
  return name;
}

/** Unpacks a feed zip into `dir` and returns the .app inside. */
export function unpack(zip: string, dir: string): string {
  mkdirSync(dir, { recursive: true });
  execFileSync('ditto', ['-x', '-k', zip, dir]);
  return join(dir, 'Taalcut.app');
}

export function bundleVersion(appPath: string): string {
  const plist = join(appPath, 'Contents', 'Info.plist');
  return execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', plist], {
    encoding: 'utf8',
  }).trim();
}

export interface LoggedUpdateEvent {
  readonly type: string;
  readonly [key: string]: unknown;
}

/**
 * The `[update] {json}` event lines main logs (src/main/update/start.ts). Main's other `[update] …` lines are
 * plain text (`[update] rollback to … prepared`, `[update] guard started`); untilLog waits for those.
 */
export function updateEvents(stderr: string): LoggedUpdateEvent[] {
  return stderr
    .split('\n')
    .filter((line) => line.startsWith('[update] {'))
    .map((line) => JSON.parse(line.slice('[update] '.length)) as LoggedUpdateEvent);
}

/**
 * electron-updater's download cache and Squirrel.Mac's staging and URL
 * caches. Cleared around every test: a cached zip would skip or short-cut
 * the download a test checks.
 */
export function clearUpdateCaches(): void {
  const caches = join(homedir(), 'Library', 'Caches');
  for (const name of ['@taalcutdesktop-updater', 'com.taalcut.app.ShipIt', 'com.taalcut.app']) {
    rmSync(join(caches, name), { recursive: true, force: true });
  }
}
