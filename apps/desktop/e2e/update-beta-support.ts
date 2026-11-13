// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The public beta channel for the update e2e (P3-B9, gate criterion 3). The feed is a folder laid out like
 * GitHub's download URLs and filled by the real release scripts (scripts/release.mjs publish/promote/pull
 * --dir), served over loopback with HTTP range support, so electron-updater's delta download works and the bytes
 * it fetched can be counted. Each scenario runs a clone of a beta build on one profile across launches, since a
 * rollback and its notice span several of them.
 */
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { binaryOf, startPackaged, waitForStderr, type RunningApp } from './packaged-app';
import { bundleVersion, runReleaseScript, updateEvents, type LoggedUpdateEvent } from './update-feed';
import { shipItDiagnostics, trackGuardProfile } from './update-processes';
export { guardRunning, stopGuards } from './update-processes';

const desktopDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const releaseDir = join(desktopDir, 'release');
export const REPO_URL = 'https://github.com/taalcut/taalcut';

/** release/<dir> for each beta build scripts/package-e2e.mjs makes. */
export const BETA_BUILDS = {
  '0.0.0-beta.1': 'beta-1',
  '0.0.0-beta.2': 'beta-2',
  '0.0.0-beta.2-broken': 'beta-2-broken',
  '0.0.0-beta.3': 'beta-3',
} as const;
export type BetaBuild = keyof typeof BETA_BUILDS;

export function betaApp(build: BetaBuild): string {
  return join(releaseDir, BETA_BUILDS[build], 'mac-arm64', 'Taalcut.app');
}

export function assertBetaBuilds(): void {
  for (const build of Object.keys(BETA_BUILDS) as BetaBuild[]) {
    const version = build.replace('-broken', '');
    const zip = join(releaseDir, BETA_BUILDS[build], `Taalcut-${version}-arm64-mac.zip`);
    if (!existsSync(binaryOf(betaApp(build))) || !existsSync(zip)) {
      throw new Error(`${build} not built. Run: pnpm --filter @taalcut/desktop e2e:update`);
    }
  }
}

export interface RangeFeed {
  readonly server: Server;
  /** http://127.0.0.1:<port> (no trailing slash): the GitHub download base the scripts write into the ymls. */
  readonly base: string;
  /** `GET /path` or `GET /path bytes=…` for each request. */
  readonly requests: string[];
  /** Body bytes sent for paths ending in `suffix`. */
  bytesFor(suffix: string): number;
  close(): Promise<void>;
}

/** Serves `root` with single and multiple byte ranges (multipart/byteranges), as GitHub's CDN does. */
export async function startRangeFeed(root: string): Promise<RangeFeed> {
  const requests: string[] = [];
  const sent = new Map<string, number>();
  const base = resolve(root);
  const count = (path: string, bytes: number) => sent.set(path, (sent.get(path) ?? 0) + bytes);
  const server = createServer((request, response) => serve(base, request, response, requests, count));
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    server,
    base: `http://127.0.0.1:${port}`,
    requests,
    bytesFor: (suffix) =>
      [...sent].filter(([path]) => path.endsWith(suffix)).reduce((sum, [, n]) => sum + n, 0),
    close: () => new Promise((done) => server.close(() => done())),
  };
}

function serve(
  base: string,
  request: IncomingMessage,
  response: ServerResponse,
  requests: string[],
  count: (path: string, bytes: number) => void,
): void {
  const path = decodeURIComponent(new URL(request.url ?? '/', 'http://feed').pathname);
  const range = request.headers.range;
  requests.push(`${request.method} ${path}${range ? ` ${range}` : ''}`);
  const file = resolve(base, `.${path}`);
  if (!file.startsWith(base + sep) || !existsSync(file) || statSync(file).isDirectory()) {
    response.writeHead(404).end();
    return;
  }
  const size = statSync(file).size;
  const spans = parseRanges(range, size);
  if (!spans) {
    response.writeHead(200, { 'Content-Length': size, 'Accept-Ranges': 'bytes' });
    count(path, size);
    createReadStream(file).pipe(response);
    return;
  }
  const data = readFileSync(file);
  if (spans.length === 1) {
    const [start, end] = spans[0] ?? [0, 0];
    response.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': end - start + 1,
    });
    count(path, end - start + 1);
    response.end(data.subarray(start, end + 1));
    return;
  }
  const boundary = 'TaalcutRangeBoundary';
  const parts = spans.map(([start, end]) =>
    Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Type: application/octet-stream\r\nContent-Range: bytes ${start}-${end}/${size}\r\n\r\n`,
      ),
      data.subarray(start, end + 1),
      Buffer.from('\r\n'),
    ]),
  );
  const body = Buffer.concat([...parts, Buffer.from(`--${boundary}--\r\n`)]);
  count(
    path,
    spans.reduce((sum, [start, end]) => sum + end - start + 1, 0),
  );
  response.writeHead(206, {
    'Content-Type': `multipart/byteranges; boundary=${boundary}`,
    'Content-Length': body.length,
  });
  response.end(body);
}

function parseRanges(header: string | undefined, size: number): [number, number][] | undefined {
  if (!header?.startsWith('bytes=')) return undefined;
  const spans: [number, number][] = [];
  for (const part of header.slice('bytes='.length).split(',')) {
    const match = /^\s*(\d+)-(\d+)\s*$/.exec(part);
    if (!match) return undefined;
    const start = Number(match[1]);
    const end = Math.min(Number(match[2]), size - 1);
    if (start > end) return undefined;
    spans.push([start, end]);
  }
  return spans.length > 0 ? spans : undefined;
}

/** `node scripts/release.mjs <args> --dir <root>`: the workflows' own scripts, signing with the e2e test key. */
export function rollout(root: string, args: string[]): string {
  return runReleaseScript([...args, '--dir', root]);
}

/**
 * The publish step for one beta build: its zip and blockmap, a stand-in DMG (first installs aren't
 * under test here), and notes in `notes` (English required).
 */
export function publishBeta(
  feed: { readonly root: string; readonly base: string },
  build: BetaBuild,
  stage: number,
  notes: Record<string, string> = { en: `- ${build}` },
): string {
  const version = build.replace('-broken', '');
  const work = join(feed.root, '..', `publish-${build}`);
  const artifacts = join(work, 'artifacts');
  const notesDir = join(work, 'notes');
  mkdirSync(artifacts, { recursive: true });
  mkdirSync(notesDir, { recursive: true });
  const built = join(releaseDir, BETA_BUILDS[build]);
  for (const name of [`Taalcut-${version}-arm64-mac.zip`, `Taalcut-${version}-arm64-mac.zip.blockmap`]) {
    copyFileSync(join(built, name), join(artifacts, name));
  }
  writeFileSync(join(artifacts, `Taalcut-${version}-arm64.dmg`), `stand-in DMG for ${build}`);
  for (const [locale, text] of Object.entries(notes)) writeFileSync(join(notesDir, `${locale}.md`), text);
  return rollout(feed.root, [
    'publish',
    '--channel',
    'beta',
    '--version',
    version,
    '--artifacts',
    artifacts,
    '--notes',
    notesDir,
    '--stage',
    String(stage),
    '--download-base',
    feed.base,
    '--repo-url',
    REPO_URL,
  ]);
}

/** A clone of `build` at `path` (APFS clone, so cheap), with the version it should have. */
export function cloneBeta(build: BetaBuild, path: string): string {
  mkdirSync(dirname(path), { recursive: true });
  execFileSync('cp', ['-cR', betaApp(build), path]);
  return path;
}

export interface BetaRun {
  readonly app: RunningApp;
  readonly userData: string;
  events(): LoggedUpdateEvent[];
  /** SIGTERM (a normal quit: will-quit runs, ShipIt installs what was staged), then wait for the exit. */
  quit(): Promise<number | string>;
}

/** Every app launchBeta started in this worker and that hasn't exited yet. */
const running = new Set<RunningApp>();

/**
 * For afterEach: kills what a failed case left running. SIGKILL, not a quit: a normal quit after staging would
 * start a guard (and ShipIt) for a profile the test is about to remove.
 */
export async function killLeftoverApps(): Promise<void> {
  const left = [...running];
  running.clear();
  for (const app of left) app.child.kill('SIGKILL');
  await Promise.all(left.map((app) => app.exited));
}

/** Starts `appPath` on `userData` against the beta channel of `feed`; the profile survives the run. */
export function launchBeta(
  appPath: string,
  userData: string,
  feed: { readonly base: string },
  extraArgs: string[] = [],
): BetaRun {
  trackGuardProfile(userData);
  const app = startPackaged(appPath, {
    userData,
    keepUserData: true,
    args: [`--taalcut-update-feed=${feed.base}/`, '--taalcut-update-channel=beta', ...extraArgs],
  });
  running.add(app);
  void app.exited.then(() => running.delete(app));
  return {
    app,
    userData,
    events: () => updateEvents(app.stderr()),
    async quit() {
      if (app.child.exitCode === null && app.child.signalCode === null) app.child.kill('SIGTERM');
      const code = await app.exited;
      await app.stop();
      return code;
    },
  };
}

/** Waits for an `[update]` event of one of `types` (e.g. 'staged|rejected|error'). */
export async function untilUpdate(
  run: BetaRun,
  types: string,
  timeoutMs = 180_000,
): Promise<LoggedUpdateEvent[]> {
  await waitForStderr(run.app, (stderr) => new RegExp(`"type":"(${types})"`).test(stderr), timeoutMs);
  return run.events();
}

/** Waits for a plain `[update] …` log line. */
export async function untilLog(run: BetaRun, pattern: RegExp, timeoutMs = 60_000): Promise<void> {
  await waitForStderr(run.app, (stderr) => pattern.test(stderr), timeoutMs);
}

/** Polls `predicate` until it holds; `context` adds to the failure message. */
export async function eventually(
  predicate: () => boolean,
  timeoutMs: number,
  what: string,
  context?: () => string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${what}${context ? `\n${context()}` : ''}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

export const versionOf = bundleVersion;

/** For a failure message: the end of main's stderr, the guard's log and what is in updates/. */
export function diagnose(run: BetaRun): string {
  const updates = join(run.userData, 'updates');
  const lines = run.app
    .stderr()
    .split('\n')
    .filter((line) => line.trim() !== '')
    .slice(-60);
  const log = join(updates, 'guard.log');
  return [
    `main:\n${lines.join('\n')}`,
    `updates/: ${existsSync(updates) ? readdirSync(updates).join(', ') : '(none)'}`,
    `guard.log:\n${existsSync(log) ? readFileSync(log, 'utf8').slice(-4000) : '(none)'}`,
    shipItDiagnostics(),
  ].join('\n');
}
