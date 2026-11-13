// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Starting a long-lived server process, behind a port so tests run a fake server and another OS brings its own.
 * `posixServerSpawn` puts the child in its own process group (a stop reaches anything it started), gives it media's
 * minimal sidecar environment plus the loader's and CUDA's (SERVER_ENV_KEYS: a CUDA build finds cuda-runtime-13
 * through LD_LIBRARY_PATH, which the jobs process was forked with), and hands its stdout and stderr to the caller
 * line by line. `createPosixServerSpawn(extraEnv)` adds variables computed at each spawn: the desktop's
 * `acceleratorEnv()`, so a cuda-runtime-13 installed after the jobs process started reaches the next server.
 * A watchdog stops the group
 * when this process exits or dies (IX-F7): the pool's idle stop lives in this process, so a killed or crashed jobs
 * process used to leave its servers, each holding a model, until logout.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { sidecarEnv, watchProcessGroup } from '@taalcut/media';

export interface ServerExit {
  readonly code: number | null;
  readonly signal: string | null;
  /** Why the process never ran: the spawn's error code (EACCES for a file that isn't executable, ENOENT for none). */
  readonly startError?: string;
}

export interface SpawnedServer {
  readonly pid: number | undefined;
  /** Settles once the process has exited; a failed spawn settles with code null and its `startError`. */
  readonly exited: Promise<ServerExit>;
  kill(signal: 'SIGTERM' | 'SIGKILL'): void;
}

export interface ServerSpawnRequest {
  readonly command: string;
  readonly args: readonly string[];
  /** The child's working folder: whisper-server writes nothing there, but `.` must not be the app's. */
  readonly cwd: string;
  readonly onLine: (line: string) => void;
}

export type ServerSpawn = (request: ServerSpawnRequest) => SpawnedServer;

/** What a GPU build needs from this process's environment besides media's sidecar keys (LNX1). */
export const SERVER_ENV_KEYS = ['LD_LIBRARY_PATH', 'CUDA_VISIBLE_DEVICES'] as const;

export function serverEnv(
  source: Readonly<Record<string, string | undefined>> = process.env,
): Record<string, string> {
  const env = sidecarEnv(source);
  for (const key of SERVER_ENV_KEYS) {
    const value = source[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

function lines(onLine: (line: string) => void): (chunk: Buffer) => void {
  let partial = '';
  return (chunk) => {
    const parts = (partial + chunk.toString('utf8')).split('\n');
    partial = parts.pop() ?? '';
    for (const line of parts) onLine(line);
  };
}

/** posixServerSpawn with `extraEnv()` over `serverEnv()`, read at each spawn. */
export function createPosixServerSpawn(
  extraEnv: () => Readonly<Record<string, string>> = () => ({}),
): ServerSpawn {
  return (request) => spawnServer(request, { ...serverEnv(), ...extraEnv() });
}

export const posixServerSpawn: ServerSpawn = createPosixServerSpawn();

function spawnServer(request: ServerSpawnRequest, env: Record<string, string>): SpawnedServer {
  const child = spawn(request.command, [...request.args], {
    cwd: request.cwd,
    env,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const watchdog = child.pid !== undefined ? watchProcessGroup(child.pid) : undefined;
  const onChunk = lines(request.onLine);
  child.stdout.on('data', onChunk);
  child.stderr.on('data', onChunk);
  const exited = new Promise<ServerExit>((resolve) => {
    // A spawn the OS refused never had a pid: say why, or it reads as a server that exited while loading.
    child.once('error', (error: NodeJS.ErrnoException) =>
      resolve({
        code: null,
        signal: null,
        ...(child.pid === undefined ? { startError: error.code ?? error.message } : {}),
      }),
    );
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  void exited.then(() => watchdog?.release());
  return {
    pid: child.pid,
    exited,
    kill(signal) {
      const pid = child.pid;
      if (pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
      try {
        process.kill(-pid, signal);
      } catch {
        // ESRCH: the group is already gone, which is what a stop wants.
      }
    },
  };
}

/** A TCP port free on 127.0.0.1 right now (the server may lose it to a race; the pool then tries again). */
export function freeLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => (port > 0 ? resolve(port) : reject(new Error('no port'))));
    });
  });
}
