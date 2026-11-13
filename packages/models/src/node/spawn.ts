// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * SpawnPort on node:child_process, for the process that hosts the local
 * runtime (the desktop main process). Node-only: reached through
 * '@taalcut/models/node', never the main entry.
 *
 * On macOS and Linux the sidecar leads its own process group, so stop() can
 * signal it with anything it starts, and a Ctrl-C meant for the app's
 * terminal doesn't reach it. A small /bin/sh watchdog in its own session
 * holds a pipe from this process: when this process dies, even by SIGKILL,
 * the pipe closes and the watchdog stops the group (SIGTERM, then SIGKILL
 * after 5 s), so a crashed app leaves no model in memory. Windows gets plain
 * spawn for now; a Job Object would do the watchdog's work there.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { SidecarExit, SpawnPort } from '../local-runtime/llama-server';

export interface NodeSpawnPort extends SpawnPort {
  /** SIGKILLs every process group it started that is still running. Synchronous: safe in an 'exit' handler. */
  dispose(): void;
}

/** POSIX sh. $1 is the sidecar's process group. Reads until EOF, which comes when the parent lets go or dies. */
const WATCHDOG = [
  'while read -r _; do :; done',
  'kill -s TERM -- "-$1" 2>/dev/null || exit 0',
  'i=0',
  'while kill -s 0 -- "-$1" 2>/dev/null && [ "$i" -lt 50 ]; do /bin/sleep 0.1; i=$((i + 1)); done',
  'kill -s KILL -- "-$1" 2>/dev/null',
  'exit 0',
].join('\n');

interface Started {
  readonly child: ChildProcess;
  readonly watchdog?: ChildProcess;
  exited: boolean;
}

export function createNodeSpawnPort(): NodeSpawnPort {
  const posix = process.platform !== 'win32';
  const live = new Set<Started>();

  const signalGroup = (started: Started, signal: NodeJS.Signals) => {
    const pid = started.child.pid;
    if (started.exited || pid === undefined) return;
    try {
      if (posix) process.kill(-pid, signal);
      else started.child.kill(signal);
    } catch {
      // Already gone (ESRCH).
    }
  };
  const retire = (started: Started) => {
    started.exited = true;
    live.delete(started);
    // Gone before its group could be reused for something else.
    started.watchdog?.kill('SIGKILL');
  };

  return {
    spawn(request) {
      const child = spawn(request.command, [...request.args], {
        // Exactly what the driver asked for: nothing inherited from this process.
        env: { ...request.env },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: posix,
        windowsHide: true,
      });
      const watchdog =
        posix && child.pid !== undefined
          ? spawn('/bin/sh', ['-c', WATCHDOG, 'taalcut-sidecar-watchdog', String(child.pid)], {
              env: {},
              stdio: ['pipe', 'ignore', 'ignore'],
              detached: true,
            })
          : undefined;
      if (watchdog) {
        // Neither the watchdog nor its pipe may keep this process alive.
        watchdog.unref();
        (watchdog.stdin as { unref?: () => void } | null)?.unref?.();
        watchdog.on('error', () => undefined);
      }
      const started: Started = { child, ...(watchdog ? { watchdog } : {}), exited: false };
      live.add(started);

      for (const stream of [child.stdout, child.stderr])
        if (stream) createInterface({ input: stream, crlfDelay: Infinity }).on('line', request.onOutput);
      const exited = new Promise<SidecarExit>((resolve) => {
        // 'close' rather than 'exit': it comes after the last output line.
        child.once('close', (code, signal) => {
          retire(started);
          resolve({ code, signal });
        });
        child.once('error', (error) => {
          request.onOutput(`spawn failed: ${error.message}`);
          if (child.pid !== undefined) return; // A running process still reports 'close'.
          retire(started);
          resolve({ code: null, signal: null });
        });
      });
      return { exited, kill: (signal) => signalGroup(started, signal) };
    },
    dispose() {
      for (const started of [...live]) {
        signalGroup(started, 'SIGKILL');
        retire(started);
      }
    },
  };
}
