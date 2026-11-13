// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P2-X5 on the packaged test build, against a loopback ingest only: crash reports are error events with no
 * environment, no home path and no user or machine names, and no process writes or sends a native dump.
 *
 * The app starts from a Finder-like environment plus a planted canary variable and a fake credential
 * (`*_TOKEN`). With reporting off, a crash of main and a window error send nothing. Once on: a crash of main
 * (reported at the next launch), of the renderer, of the agent and of jobs, a JavaScript error in main and a
 * window's error report each arrive once, scrubbed. `-ApplePersistenceIgnoreState YES` keeps AppKit's
 * "reopen windows?" alert, which follows a crash, from holding the next start. The build this runs on has no
 * copy of the SDK outside main's bundle (packaging/app-files.ts), so main starts and reports without one.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { hostname, tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { startIngest, type IngestRequest, type MockIngest } from '../test/helpers/mock-ingest';
import { openAsar } from './asar';
import { connectToPage } from './cdp';
import { dispatchAsPerson } from './probe-commands';
import {
  assertPackaged,
  devToolsPort,
  PACKAGED_UNAVAILABLE,
  type RunningApp,
  startPackaged,
  TEST_APP,
} from './packaged-app';

const HOME = userInfo().homedir;
const USER = userInfo().username;
const HOST = hostname();
const CANARY_NAME = 'TAALCUT_E2E_CANARY';
const CANARY = `canary-${randomBytes(12).toString('hex')}`;
const TOKEN_NAME = 'TAALCUT_E2E_PLANTED_TOKEN';
const TOKEN = `tok_${randomBytes(16).toString('hex')}`;
/** What a Finder launch gets from launchd, plus the two planted variables. */
const ENV: NodeJS.ProcessEnv = {
  HOME,
  USER,
  LOGNAME: USER,
  SHELL: process.env.SHELL ?? '/bin/zsh',
  TMPDIR: tmpdir(),
  PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
  [CANARY_NAME]: CANARY,
  [TOKEN_NAME]: TOKEN,
};
const WINDOW_ERROR = `window error: could not open ${HOME}/Movies/beach.mov as ${USER} on ${HOST} (${TOKEN})`;
const NAME = (name: string) => (name.length >= 3 ? '<name>' : name);

interface SentEvent {
  readonly message?: string;
  readonly release?: string;
  readonly tags?: Record<string, string>;
  readonly contexts?: Record<string, Record<string, unknown>>;
  readonly exception?: { values: Array<{ value?: string }> };
}

let ingest: MockIngest;
let userData: string;

test.skip(Boolean(PACKAGED_UNAVAILABLE), PACKAGED_UNAVAILABLE);
test.beforeAll(async () => {
  assertPackaged(TEST_APP);
  ingest = await startIngest();
  userData = mkdtempSync(join(tmpdir(), 'taalcut-crash-e2e-'));
});

test.afterAll(async () => {
  await ingest.close();
  rmSync(userData, { recursive: true, force: true });
});

function launch(crash?: string): RunningApp {
  return startPackaged(TEST_APP, {
    userData,
    keepUserData: true,
    env: ENV,
    args: [
      '--remote-debugging-port=0',
      `--taalcut-crash-dsn=${ingest.dsn}`,
      ...(crash ? [`--taalcut-test-crash=${crash}`] : []),
      '-ApplePersistenceIgnoreState',
      'YES',
    ],
  });
}

async function until(what: string, check: () => boolean, ms = 30_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline)
      throw new Error(`timed out waiting for ${what}; received ${JSON.stringify(events().map(textOf))}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The events in every envelope received so far. */
function events(): SentEvent[] {
  return ingest.requests.flatMap((request) => {
    const lines = request.body.toString('utf8').split('\n');
    const found: SentEvent[] = [];
    for (let i = 1; i + 1 < lines.length; i += 1) {
      const header = JSON.parse(lines[i] ?? '{}') as { type?: string };
      if (header.type === 'event') found.push(JSON.parse(lines[i + 1] ?? '{}') as SentEvent);
    }
    return found;
  });
}

function textOf(event: SentEvent): string {
  return event.message ?? event.exception?.values[0]?.value ?? '';
}

const count = (match: (text: string) => boolean) => events().filter((event) => match(textOf(event))).length;

/** Crashpad's files (`*.dmp`, pending uploads) anywhere in this profile. */
function dumpsOnDisk(): string[] {
  const crashpad = join(userData, 'Crashpad');
  if (!existsSync(crashpad)) return [];
  return readdirSync(crashpad, { recursive: true })
    .map(String)
    .filter((file) => /\.dmp$|pending/.test(file));
}

async function crashed(app: RunningApp): Promise<void> {
  const ended = await app.exitWithin(60_000);
  expect(ended, app.stderr()).toBe('SIGSEGV');
  expect(dumpsOnDisk()).toEqual([]);
}

async function reportFromWindow(app: RunningApp, message: string): Promise<string> {
  const page = await connectToPage(await devToolsPort(app), 'app://');
  try {
    return await page.evaluate(
      async (input) => {
        const rpc = await window.taalcutProbe?.client;
        if (!rpc) return 'no client';
        return rpc.crashes.report({ kind: 'error', ...input }).then(
          () => 'ok',
          (error: { data?: { code?: string } }) => error.data?.code ?? String(error),
        );
      },
      {
        message,
        stack: `Error: ${message}\n    at open (${HOME}/Library/x.js:1:2)\n    at app://taalcut/a.js:3:4`,
      },
    );
  } finally {
    page.close();
  }
}

function leaksIn(request: IngestRequest): string[] {
  const text = `${request.url}\n${request.body.toString('latin1')}`;
  const planted = [CANARY_NAME, CANARY, TOKEN_NAME, TOKEN, HOME, USER];
  if (HOST.length >= 3) planted.push(HOST.replace(/\.local$/i, ''));
  return planted.filter((value) => text.toLowerCase().includes(value.toLowerCase()));
}

test('the SDK ships inside main only: app.asar has no @sentry or @opentelemetry copy', () => {
  const asar = openAsar(join(TEST_APP, 'Contents', 'Resources', 'app.asar'));
  const files = [...asar.files.keys()];
  expect(files.filter((file) => /^node_modules\/@(sentry|opentelemetry)\//.test(file))).toEqual([]);
  const main = files.filter((file) => file.startsWith('out/main/')).map((file) => asar.readText(file));
  expect(main.some((code) => code.includes('sentry.javascript.electron'))).toBe(true);
});

test('crash reports carry no environment, home path or names, and no process sends a dump', async () => {
  test.setTimeout(300_000);

  // Off (the default): a crash of main and a window's error report send nothing, and leave no dump.
  await crashed(launch('main'));
  const off = launch();
  expect(await reportFromWindow(off, WINDOW_ERROR)).toBe('ok');
  await settle(3_000);
  expect(ingest.requests).toEqual([]);
  // Opt in as the person; it takes effect at the next launch.
  const page = await connectToPage(await devToolsPort(off), 'app://');
  expect(await dispatchAsPerson(page, 'privacy.setCrashReports', { enabled: true })).toBe('ok');
  page.close();
  await until('privacy.json to say on', () =>
    readFileSync(join(userData, 'privacy.json'), 'utf8').includes('"crashReports":true'),
  );
  await off.stop();
  expect(ingest.requests).toEqual([]);

  // On. Main crashes: nothing can be sent from a dead process, and no dump is written.
  await crashed(launch('main'));
  expect(existsSync(join(userData, 'last-run.json'))).toBe(true);

  // The next launch reports that run; then the agent crashes and the window reports an error.
  const agent = launch('agent');
  await until('the last run of main', () => count((t) => t === 'main process ended without quitting') === 1);
  await until('the agent exit', () => count((t) => t.startsWith('utility agent exited')) === 1);
  expect(await reportFromWindow(agent, WINDOW_ERROR)).toBe('ok');
  await until('the window error', () => count((t) => t.startsWith('window error:')) === 1);
  await agent.stop();

  const jobs = launch('jobs');
  await until('the jobs exit', () => count((t) => t.startsWith('utility jobs exited')) === 1);
  await jobs.stop();
  const renderer = launch('renderer');
  await until('the renderer gone', () => count((t) => t === 'render process gone: crashed') === 1);
  await renderer.stop();
  const mainError = launch('main-error');
  await until('the main error', () => count((t) => t.startsWith('test error: could not open')) === 1);
  await mainError.stop();
  await settle(3_000);

  // Each one arrived once, and nothing else did: quits in between left no run to report.
  const texts = events().map(textOf).sort();
  expect(texts).toHaveLength(6);
  expect(count((t) => t === 'main process ended without quitting')).toBe(1);
  const lastRun = events().find((event) => textOf(event) === 'main process ended without quitting');
  expect(lastRun?.contexts?.last_run?.version).toBe('0.0.0');
  expect(lastRun?.tags?.process).toBe('main');
  expect(texts).toContain(`window error: could not open <path:.mov> as <name> on ${NAME(HOST)} ([REDACTED])`);
  expect(texts).toContain('test error: could not open <path:.mov> for <name>');
  expect(existsSync(join(userData, 'last-run.json'))).toBe(false);
  expect(dumpsOnDisk()).toEqual([]);

  // What was sent, for the report: the planted values are fake, and none may be in it.
  await test.info().attach('received-events.json', {
    body: JSON.stringify(events(), null, 2),
    contentType: 'application/json',
  });
  // Envelopes only: no minidump endpoint, no multipart upload, no minidump bytes; nothing planted.
  for (const request of ingest.requests) {
    expect(request.url).toMatch(/^\/api\/1\/envelope\//);
    expect(request.contentType).not.toMatch(/multipart/);
    expect(request.body.includes('MDMP')).toBe(false);
    expect(leaksIn(request)).toEqual([]);
  }
});
