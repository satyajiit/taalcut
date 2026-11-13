// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Starting and stopping the packaged apps in tests. scripts/package-e2e.mjs
 * builds them:
 *   release/mac-arm64/Taalcut.app        release build (what ships)
 *   release/test/mac-arm64/Taalcut.app   test build: accepts --remote-debugging-port
 *                                        and the test-only switches
 *   release/update/                      version 0.0.1 of the test build as a zip,
 *                                        with latest-mac.yml (the update feed)
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const releaseDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'release');

/**
 * Why the packaged e2e can't run on this machine, or undefined on a Mac (LNX1-PKG). It drives the macOS bundle
 * scripts/package-e2e.mjs builds (Taalcut.app, its signature, hardening and Squirrel updates); every packaged*.e2e.ts
 * skips with this. A Linux .deb is checked by scripts/linux/verify-deb.mjs after package:linux.
 */
export const PACKAGED_UNAVAILABLE =
  process.platform === 'darwin'
    ? undefined
    : 'packaged e2e: skipped, it drives the macOS app (release/mac-arm64/Taalcut.app); a .deb is checked by scripts/linux/verify-deb.mjs';
export const RELEASE_APP = join(releaseDir, 'mac-arm64', 'Taalcut.app');
export const TEST_APP = join(releaseDir, 'test', 'mac-arm64', 'Taalcut.app');
export const UPDATE_FEED_DIR = join(releaseDir, 'update');

export function binaryOf(appPath: string): string {
  return join(appPath, 'Contents', 'MacOS', 'Taalcut');
}

export function assertPackaged(...appPaths: string[]): void {
  for (const appPath of appPaths) {
    if (!existsSync(binaryOf(appPath))) {
      throw new Error(`${appPath} not found. Run: pnpm --filter @taalcut/desktop e2e:packaged`);
    }
  }
}

export interface RunningApp {
  readonly child: ChildProcess;
  /** Everything the app wrote to stdout / stderr so far. */
  stdout(): string;
  stderr(): string;
  /** Resolves with the exit code (or signal) once the app has exited. */
  readonly exited: Promise<number | string>;
  /** Resolves with the exit code, or 'still running' after `ms`. */
  exitWithin(ms: number): Promise<number | string>;
  /** Kills the app if it is still running, waits for it, removes its user data. */
  stop(): Promise<void>;
}

/**
 * Starts an app with its own throwaway user data. --use-mock-keychain keeps
 * cookie encryption away from the login keychain, so an ad-hoc build never
 * prompts for keychain access.
 */
export function startPackaged(
  appPath: string,
  options: { args?: string[]; env?: NodeJS.ProcessEnv; userData?: string; keepUserData?: boolean } = {},
): RunningApp {
  // A test may prepare the user data first (e.g. installed components); stop() removes it either way.
  const userData = options.userData ?? mkdtempSync(join(tmpdir(), 'taalcut-packaged-'));
  const child = spawn(
    binaryOf(appPath),
    [`--user-data-dir=${userData}`, '--use-mock-keychain', ...(options.args ?? [])],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: options.env ?? process.env,
    },
  );
  let out = '';
  let err = '';
  child.stdout?.on('data', (chunk: Buffer) => (out += chunk.toString()));
  child.stderr?.on('data', (chunk: Buffer) => (err += chunk.toString()));
  const exited = new Promise<number | string>((resolve) =>
    child.once('exit', (code, signal) => resolve(code ?? signal ?? 'unknown')),
  );
  return {
    child,
    stdout: () => out,
    stderr: () => err,
    exited,
    exitWithin: (ms) =>
      Promise.race([
        exited,
        new Promise<string>((resolve) => setTimeout(() => resolve('still running'), ms)),
      ]),
    async stop() {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM');
        // A quit caught mid-startup can stall; never leave an orphaned app behind.
        const force = setTimeout(() => child.kill('SIGKILL'), 3_000);
        await exited;
        clearTimeout(force);
      }
      // The update tests launch one profile several times (before and after an update or a rollback).
      if (!options.keepUserData) rmSync(userData, { recursive: true, force: true });
    },
  };
}

/** The port Chromium picked for --remote-debugging-port=0, read from stderr. */
export async function devToolsPort(app: RunningApp, timeoutMs = 15_000): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const match = /DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//.exec(app.stderr());
    if (match?.[1]) return Number(match[1]);
    if (app.child.exitCode !== null || app.child.signalCode !== null || Date.now() > deadline) {
      throw new Error(`no DevTools endpoint; stderr:\n${app.stderr()}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** Waits until `predicate(stderr)` holds, or throws with the output so far. */
export async function waitForStderr(
  app: RunningApp,
  predicate: (stderr: string) => boolean,
  timeoutMs: number,
) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate(app.stderr())) {
    if (app.child.exitCode !== null || app.child.signalCode !== null || Date.now() > deadline) {
      throw new Error(`timed out; stderr:\n${app.stderr()}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
