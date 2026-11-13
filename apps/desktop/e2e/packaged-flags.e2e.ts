// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The flag guard (src/main/security/switches.ts) on the packaged apps: the
 * release build exits with code 1 and says why when given a switch that
 * weakens it, before anything it asked for can happen (no DevTools server,
 * no inspector, nothing logged, no launcher run). The test build accepts
 * remote debugging and the mock keychain, but still refuses the rest.
 *
 * startPackaged always adds --use-mock-keychain, which release builds refuse
 * too; each test checks for its own switch in the message.
 */
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { assertPackaged, PACKAGED_UNAVAILABLE, RELEASE_APP, startPackaged, TEST_APP } from './packaged-app';

let scratch: string;

test.skip(Boolean(PACKAGED_UNAVAILABLE), PACKAGED_UNAVAILABLE);
test.beforeAll(() => {
  assertPackaged(RELEASE_APP, TEST_APP);
  scratch = mkdtempSync(join(tmpdir(), 'taalcut-flags-'));
});

test.afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** `--name` for a switch, or the bare name of an environment variable. */
async function expectRefused(
  appPath: string,
  args: string[],
  refused: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const app = startPackaged(appPath, { args, env });
  try {
    expect(await app.exitWithin(10_000), app.stderr()).toBe(1);
    const stderr = app.stderr();
    expect(stderr).toContain('Taalcut: refusing to start with');
    expect(stderr).toContain(`${refused} (`);
    expect(stderr).not.toContain('DevTools listening');
    expect(stderr).not.toContain('Debugger listening');
    return stderr;
  } finally {
    await app.stop();
  }
}

const RELEASE_REFUSES: readonly (readonly [string, string])[] = [
  ['--remote-debugging-port=0', 'remote-debugging-port'],
  ['--remote-debugging-pipe', 'remote-debugging-pipe'],
  ['--inspect=0', 'inspect'],
  ['--inspect-brk=0', 'inspect-brk'],
  ['--js-flags=--allow-natives-syntax', 'js-flags'],
  ['--no-sandbox', 'no-sandbox'],
  ['--disable-gpu-sandbox', 'disable-gpu-sandbox'],
  ['--single-process', 'single-process'],
  ['--in-process-gpu', 'in-process-gpu'],
  ['--disable-web-security', 'disable-web-security'],
  ['--ignore-certificate-errors', 'ignore-certificate-errors'],
  ['--enable-logging=file', 'enable-logging'],
  // SB-7: a security feature by name, and the TLS key log.
  ['--disable-features=Translate,IsolateOrigins', 'disable-features'],
  ['--ssl-key-log-file=/tmp/taalcut-keys.log', 'ssl-key-log-file'],
];

for (const [arg, name] of RELEASE_REFUSES) {
  test(`the release build refuses ${arg}`, async () => {
    await expectRefused(RELEASE_APP, [arg], `--${name}`);
  });
}

/** Electron opens the log file before main runs (SECURITY.md, known gaps); the guard exits before anything is logged. */
const logSize = (file: string) => (existsSync(file) ? statSync(file).size : 0);

test('the release build logs nothing to the file and starts no launcher it was given', async () => {
  const log = join(scratch, 'chromium.log');
  const marker = join(scratch, 'launcher.ran');
  const launcher = join(scratch, 'launcher.sh');
  writeFileSync(launcher, `#!/bin/sh\ntouch '${marker}'\nexec "$@"\n`, { mode: 0o755 });
  const stderr = await expectRefused(
    RELEASE_APP,
    [
      '--enable-logging=file',
      `--log-file=${log}`,
      `--renderer-cmd-prefix=${launcher}`,
      `--gpu-launcher=${launcher}`,
    ],
    '--log-file',
  );
  expect(stderr).toContain('--renderer-cmd-prefix (');
  expect(stderr).toContain('--gpu-launcher (');
  expect(logSize(log)).toBe(0);
  expect(existsSync(marker)).toBe(false);
});

test('the release build refuses logging to a file set through the environment', async () => {
  const log = join(scratch, 'env.log');
  const env = { ...process.env, ELECTRON_ENABLE_LOGGING: 'file', ELECTRON_LOG_FILE: log };
  const stderr = await expectRefused(RELEASE_APP, [], 'ELECTRON_LOG_FILE', env);
  expect(stderr).toContain('ELECTRON_ENABLE_LOGGING (');
  expect(logSize(log)).toBe(0);
});

test('the release build refuses a TLS key log set through the environment, and writes no key', async () => {
  const keys = join(scratch, 'keys.log');
  const stderr = await expectRefused(RELEASE_APP, [], 'SSLKEYLOGFILE', {
    ...process.env,
    SSLKEYLOGFILE: keys,
  });
  expect(stderr).toContain('writes the keys of its encrypted connections');
  expect(logSize(keys)).toBe(0);
});

test('the release build still starts with a support workaround that turns off a harmless feature', async () => {
  const app = startPackaged(RELEASE_APP, { args: ['--disable-features=Translate'] });
  try {
    // startPackaged adds --use-mock-keychain, so the release build refuses that one, and only that one.
    expect(await app.exitWithin(10_000), app.stderr()).toBe(1);
    expect(app.stderr()).toContain('--use-mock-keychain (');
    expect(app.stderr()).not.toContain('--disable-features (');
  } finally {
    await app.stop();
  }
});

test('the test build accepts remote debugging and the mock keychain, but not --no-sandbox', async () => {
  const stderr = await expectRefused(TEST_APP, ['--remote-debugging-port=0', '--no-sandbox'], '--no-sandbox');
  expect(stderr).not.toContain('--remote-debugging-port (');
  expect(stderr).not.toContain('--use-mock-keychain (');
});
