// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * When a process started, to tell a session child from a later process that got its pid (IX3-F5, H4). `ps`
 * prints `lstart` in the C locale and UTC, so every process of the app reads the same text for the same process.
 */
import { execFile } from 'node:child_process';

export type ProcessStart =
  | { readonly kind: 'started'; readonly at: string }
  /** No process has the pid. */
  | { readonly kind: 'gone' }
  /** `ps` could not say (no `ps`, Windows, a spawn failure). */
  | { readonly kind: 'unknown'; readonly detail: string };

const PS_ENV = { PATH: '/bin:/usr/bin', LC_ALL: 'C', TZ: 'UTC' };

export interface ProcessStartOptions {
  /** Default `ps`; tests give a stand-in. */
  readonly ps?: string;
  /** Default 5 s; the timeout signals `ps`, never the process asked about. */
  readonly timeoutMs?: number;
  /** Default `process.platform`. */
  readonly platform?: NodeJS.Platform;
}

export function processStart(pid: number, options: ProcessStartOptions = {}): Promise<ProcessStart> {
  if ((options.platform ?? process.platform) === 'win32')
    return Promise.resolve({ kind: 'unknown', detail: 'no ps on Windows' });
  return new Promise((resolve) => {
    execFile(
      options.ps ?? 'ps',
      ['-o', 'lstart=', '-p', String(pid)],
      { env: PS_ENV, timeout: options.timeoutMs ?? 5_000 },
      (error, stdout) => {
        const at = String(stdout).trim();
        if (at !== '' && !error) return resolve({ kind: 'started', at });
        // ps exits 1 and prints nothing when no process has the pid.
        if (at === '' && error?.code === 1) return resolve({ kind: 'gone' });
        resolve({ kind: 'unknown', detail: error ? error.message : 'ps printed nothing' });
      },
    );
  });
}
