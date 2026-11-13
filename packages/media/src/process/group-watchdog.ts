// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A long-lived child that must not outlive this process (IX-F7). macOS has no
 * parent-death signal, so a small /bin/sh watchdog in its own session holds a
 * pipe from this process: when this process exits or dies, even by SIGKILL,
 * the pipe closes and the watchdog stops the child's process group (SIGTERM,
 * then SIGKILL after 5 s). It signals only the group it was given, and is
 * released (killed) as soon as that group's leader exits, before the id can
 * be reused. The same shape as models' llama-server watchdog
 * (`@taalcut/models/node`), which may import only core.
 *
 * For model servers (whisper-server), never for FFmpeg: a process that may
 * hold a VideoToolbox session is never signalled from outside its job.
 */
import { spawn } from 'node:child_process';
import { USE_PROCESS_GROUPS } from './child-group';

/** POSIX sh. $1 is the process group. Reads until EOF, which comes when this process lets go or dies. */
const WATCHDOG = [
  'while read -r _; do :; done',
  'kill -s TERM -- "-$1" 2>/dev/null || exit 0',
  'i=0',
  'while kill -s 0 -- "-$1" 2>/dev/null && [ "$i" -lt 50 ]; do /bin/sleep 0.1; i=$((i + 1)); done',
  'kill -s KILL -- "-$1" 2>/dev/null',
  'exit 0',
].join('\n');

export interface GroupWatchdog {
  /** The watchdog's own pid (tests), undefined where there is none. */
  readonly pid: number | undefined;
  /** The group's leader exited on its own: stop watching, so a reused id is never signalled. */
  release(): void;
}

/**
 * Watches process group `pgid` (a child spawned with `detached: true` leads its own group) until `release()` or
 * this process's end. Windows has no groups here: a no-op (a Job Object would do this there).
 */
export function watchProcessGroup(pgid: number): GroupWatchdog {
  if (!USE_PROCESS_GROUPS) return { pid: undefined, release: () => undefined };
  const watchdog = spawn('/bin/sh', ['-c', WATCHDOG, 'taalcut-group-watchdog', String(pgid)], {
    env: {},
    stdio: ['pipe', 'ignore', 'ignore'],
    detached: true,
  });
  // Neither the watchdog nor its pipe may keep this process alive.
  watchdog.unref();
  (watchdog.stdin as { unref?: () => void } | null)?.unref?.();
  watchdog.on('error', () => undefined);
  watchdog.stdin?.on('error', () => undefined);
  return {
    pid: watchdog.pid,
    release() {
      if (watchdog.exitCode === null && watchdog.signalCode === null) watchdog.kill('SIGKILL');
    },
  };
}
