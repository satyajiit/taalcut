// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Main's side of rollback on a failed launch (P3-B9), wired in index.ts with one call at each step:
 *
 *   checkUpdateLaunch()      first thing after the single-instance lock: launch-check.ts; hands over to the guard
 *                            (--rollback-now) and quits after too many failed launches. A test build baked with
 *                            TAALCUT_TEST_UPDATE_FAULT=exit-before-ready exits here, to stand in for a broken build.
 *   watchUpdateLaunch()      once the window exists: the rollback notice (rollback-notice.ts), the cleanup after a
 *                            healthy update, and, on a new version's first launches, the health watch (health.ts)
 *                            that writes healthy-<version> and records update.installed.
 *
 * The Electron and process calls are here; every rule is in the Electron-free modules it calls.
 */
import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { callRpc, type SettingsStore, type Telemetry, type UpdateChannel } from '@taalcut/core';
import { app, type BrowserWindow } from 'electron';
import { RPC_IPC } from '../../shared/rpc-ipc';
import type { UtilityHost } from '../rpc/utility-host';
import { blockedVersions } from './blocked';
import { createBundleOps } from './bundle-ops';
import { installGuard } from './guard-binary';
import { createHealthWatch, writeHealthyMarker, type HealthSignal } from './health';
import { registeredUpdateHost } from './host';
import { checkLaunch, guardArguments, type LaunchVerdict } from './launch-check';
import { takeRollbackNotice } from './rollback-notice';
import { updatePaths, type UpdatePaths } from './update-files';
import { recordUpdateInstalled, recordUpdateRolledBack } from './update-telemetry';
import { runExec } from './verify-download';

export interface LaunchState {
  readonly paths: UpdatePaths;
  readonly verdict: LaunchVerdict;
  /** When this process started, so the health deadline counts the time before main's code ran. */
  readonly startedAt: number;
}

/** Starts `binary` in its own session, so it outlives the app; stdout and stderr go to `logFile`. */
export function spawnDetached(binary: string, args: readonly string[], logFile: string): void {
  mkdirSync(dirname(logFile), { recursive: true, mode: 0o700 });
  const log = openSync(logFile, 'a', 0o600);
  try {
    // A minimal environment: the guard needs nothing from the app's.
    const child = spawn(binary, [...args], {
      detached: true,
      stdio: ['ignore', log, log],
      env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: process.env.HOME ?? '' },
    });
    child.unref();
  } finally {
    closeSync(log);
  }
}

/**
 * The guard and ShipIt relaunch the app with no arguments. A packaged test build (the update e2e's) must never
 * run on this Mac's real profile, not even to take the single-instance lock in it: without --user-data-dir it
 * quits before anything else. True when the app is quitting.
 */
export function refuseRealProfileInTestBuild(): boolean {
  if (__TAALCUT_FLAVOUR__ !== 'test' || !app.isPackaged || app.commandLine.hasSwitch('user-data-dir'))
    return false;
  console.warn('[update] test build started without --user-data-dir: not touching the real profile');
  app.exit(0);
  return true;
}

/** null: the app is exiting (the guard took over, or a test build's fault). */
export function checkUpdateLaunch(
  options: { background?: boolean; startedAt?: number } = {},
): LaunchState | null {
  const startedAt = options.startedAt ?? Date.now() - Math.round(process.uptime() * 1000);
  const paths = updatePaths(app.getPath('userData'));
  const verdict = checkLaunch({ paths, version: app.getVersion(), background: options.background });
  if (verdict.kind === 'normal' && verdict.problem)
    console.warn(`[update] launch check: ${verdict.problem.code}`);
  if (verdict.kind === 'rollback-now' && rollBackNow(paths, verdict.pending)) return null;
  if (__TAALCUT_FLAVOUR__ === 'test' && __TAALCUT_TEST_UPDATE_FAULT__ === 'exit-before-ready') {
    console.warn('[update] test fault: exit-before-ready');
    app.exit(1);
    return null;
  }
  return { paths, verdict, startedAt };
}

/**
 * Hands over to a fresh copy of this bundle's guard (guard-binary.ts, SB-40) and exits; false when there is none
 * to hand over to, and the app starts anyway.
 */
function rollBackNow(paths: UpdatePaths, pending: { to: string; launchAttempts: number }): boolean {
  const source = join(process.resourcesPath, 'bin', 'taalcut');
  if (!existsSync(source)) {
    console.warn('[update] no guard to roll back with; starting anyway');
    return false;
  }
  try {
    installGuard(source, paths.guardBinary);
  } catch (cause) {
    console.warn(`[update] guard not copied (${String(cause)}); starting anyway`);
    return false;
  }
  console.warn(`[update] ${pending.to} failed to start ${pending.launchAttempts} times: rolling back`);
  spawnDetached(paths.guardBinary, guardArguments(paths.pending, 'rollback-now'), paths.guardLog);
  app.exit(0);
  return true;
}

export interface WatchUpdateLaunchDeps {
  readonly host: Pick<UtilityHost, 'client' | 'onConnected'>;
  readonly settings: SettingsStore;
  readonly window: BrowserWindow;
  /** The channel in force, for update.installed when pending.json didn't record one. */
  readonly channel: UpdateChannel | null;
}

function agentTelemetry(host: Pick<UtilityHost, 'client'>): Telemetry {
  return {
    record(event) {
      void callRpc(host.client('agent').telemetryIngest.record({ event }));
    },
  };
}

export function watchUpdateLaunch(launch: LaunchState, deps: WatchUpdateLaunchDeps): void {
  const telemetry = agentTelemetry(deps.host);
  const notice = takeRollbackNotice(launch.paths);
  for (const problem of notice.problems) console.warn(`[update] ${problem.code}: ${problem.detail ?? ''}`);
  if (notice.installFailed) {
    console.warn(`[update] ${notice.installFailed.to} never replaced ${notice.installFailed.from}`);
  }
  if (notice.last) {
    console.warn(`[update] last rollback: ${JSON.stringify(notice.last)}`);
    registeredUpdateHost()?.noteRollback(notice.last);
  }
  if (notice.fresh) {
    const fresh = notice.fresh;
    void blockedVersions(deps.settings)
      .block(fresh.to)
      .then((blocked) => {
        if (!blocked.ok) console.warn(`[update] ${fresh.to} not blocked: ${blocked.error.code}`);
      });
    recordUpdateRolledBack(telemetry, fresh);
  }
  const { verdict } = launch;
  if (verdict.kind === 'normal') {
    const bundles = createBundleOps(runExec);
    for (const path of verdict.cleanup) {
      void bundles
        .remove(path)
        .catch((cause: unknown) => console.warn(`[update] cleanup ${path}: ${String(cause)}`));
    }
    return;
  }
  if (verdict.kind !== 'updated') return;
  const { pending } = verdict;
  const health = createHealthWatch({
    now: Date.now,
    startedAt: launch.startedAt,
    onHealthy: () => {
      try {
        writeHealthyMarker(launch.paths.healthy(pending.to));
      } catch (cause) {
        console.warn(`[update] healthy marker not written: ${String(cause)}`);
        return;
      }
      console.warn(`[update] ${pending.to} is healthy`);
      recordUpdateInstalled(telemetry, pending, deps.channel);
    },
  });
  // The library opened and migrated before composeMain returned.
  health.mark('database');
  watchProcesses(deps.host, (signal) => health.mark(signal));
  deps.window.once('ready-to-show', () => health.mark('window'));
  deps.window.webContents.ipc.once(RPC_IPC.connect, () => health.mark('renderer'));
}

/** Marks agent and jobs once each answers a diagnostics.ping, also after a restart. */
function watchProcesses(
  host: Pick<UtilityHost, 'client' | 'onConnected'>,
  mark: (signal: HealthSignal) => void,
): void {
  const answered = new Set<'agent' | 'jobs'>();
  const ping = (process: 'agent' | 'jobs') => {
    if (answered.has(process)) return;
    void callRpc(host.client(process).diagnostics.ping()).then((pong) => {
      if (!pong.ok || answered.has(process)) return;
      answered.add(process);
      mark(process);
    });
  };
  const off = host.onConnected((process) => {
    if (process === 'agent' || process === 'jobs') ping(process);
    if (answered.size === 2) off();
  });
  ping('agent');
  ping('jobs');
}
