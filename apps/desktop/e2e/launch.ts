// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The one way e2e tests start the unpackaged build (out/) under Playwright.
 *
 * electron.launch used to hang now and then at a worker's first launch,
 * more often under load, with the app fully up. Cause: with executablePath,
 * Playwright doesn't inject its loader, which holds 'ready' until it has
 * attached. So main created the window and started loading app://taalcut/
 * while Playwright attached. When it attached mid-navigation, the page's
 * frame tree still showed the initial empty document and Chromium never sent
 * that session Page.frameNavigated for the commit; Playwright waits for that
 * first real navigation before electron.launch resolves, so it waited
 * forever. hold-ready.cjs restores the hold without Playwright's extra
 * Chromium switches: the window now opens after Playwright attaches, and new
 * pages wait for its debugger. Measured on fresh workers: 14 of 30 launches
 * hung without it, 0 of 65 with it (25 of those under CPU load).
 *
 * First run (P2-X4): a userData the app has never opened starts on the
 * welcome, not the chat. The tests are about someone who has set Taalcut up,
 * so the launch marks first run done in the library first, the way skipping
 * or finishing it does; `firstRun: 'as-stored'` leaves it as the app keeps
 * it (window-first-run.e2e.ts, the welcome on a true first run).
 *
 * Keychain: every launch adds --use-mock-keychain (test builds accept it; startPackaged
 * does the same for the packaged ones), so the vault encrypts with Chromium's fixed test key
 * instead of the login keychain of whoever runs the suite. Without it the run depends on that
 * keychain: under a HOME that has none (a test's own HOME, a fresh runner's) or a locked one,
 * macOS asks the person, and an unattended run has no one to answer. Measured: an MCP
 * session's vault write waited until the test's 60 s ran out, under a HOME with no keychain.
 * Linux's counterpart is --password-store=basic, added there too (LNX1-PKG): Chromium's fixed key
 * instead of the GNOME Keyring or KWallet of whoever runs the suite, and the vault trusts it only
 * when asked for by name like this (platform/linux.ts keyringPolicyFor; release builds refuse it).
 *
 * Logs: each launch gets TAALCUT_TEST_LOG_DIR, a folder in the test's output
 * (`app-logs-<n>`, named in the test's annotations), where the test build writes
 * main's console and every utility process's stderr as they arrive
 * (src/main/test-process-logs.ts). A failure's artifacts then say what the jobs
 * or agent process said, even when the app hung or was killed.
 */
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron, test, type ElectronApplication } from '@playwright/test';
import { seedFirstRunDone } from './library-seed';

export const desktopDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const electronPath = createRequire(import.meta.url)('electron') as string;
const holdReady = join(desktopDir, 'e2e', 'hold-ready.cjs');
/** The test's own keychain or keyring, never the developer's (above). */
export const MOCK_KEYRING: readonly string[] =
  process.platform === 'linux' ? ['--use-mock-keychain', '--password-store=basic'] : ['--use-mock-keychain'];

let launches = 0;

/** This launch's log folder in the current test's output, named in its annotations. */
function appLogDir(): string {
  launches += 1;
  const dir = test.info().outputPath(`app-logs-${launches}`);
  test.info().annotations.push({ type: 'app logs', description: dir });
  return dir;
}

type LaunchOptions = Omit<NonNullable<Parameters<typeof _electron.launch>[0]>, 'executablePath' | 'args'> & {
  /** 'done' (the default): first run is marked finished before launch. 'as-stored': untouched. */
  readonly firstRun?: 'done' | 'as-stored';
};

/** Launches the unpackaged build on its own userData; `options` as for electron.launch, `extraArgs` after ours. */
export async function launchElectron(
  userData: string,
  options: LaunchOptions = {},
  extraArgs: readonly string[] = [],
): Promise<ElectronApplication> {
  const { firstRun = 'done', ...launch } = options;
  if (firstRun === 'done') await seedFirstRunDone(userData);
  return _electron.launch({
    ...launch,
    env: { ...(launch.env ?? process.env), TAALCUT_TEST_LOG_DIR: appLogDir() },
    executablePath: electronPath,
    args: ['-r', holdReady, desktopDir, `--user-data-dir=${userData}`, ...MOCK_KEYRING, ...extraArgs],
  });
}
