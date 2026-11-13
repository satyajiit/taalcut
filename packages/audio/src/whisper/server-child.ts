// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The `whisper-server` child process and what it prints: the last lines (for errors), the backend it says it
 * runs on (`cpu` once it reports no GPU), progress lines for the request in flight, its exit, and stopping it
 * (SIGTERM, then SIGKILL after 3 s).
 */
import { join } from 'node:path';
import { gpuLine, progressOf, whisperServerArgs, type WhisperServerConfig } from './server-args';
import type { ServerExit, ServerSpawn } from './server-spawn';

export interface ServerChild {
  readonly pid: number | undefined;
  /** Settles with the exit, for any reason. */
  readonly exited: Promise<ServerExit>;
  exit(): ServerExit | undefined;
  /** The last lines it printed. */
  output(): string;
  backend(): 'gpu' | 'cpu';
  /** Where progress lines go now (the request in flight), or nowhere. */
  onProgress(listener: ((fraction: number) => void) | undefined): void;
  stop(): Promise<void>;
}

export interface ServerChildRequest {
  readonly spawn: ServerSpawn;
  /** The process's working folder; `<dir>/no-public` is never created. */
  readonly workDir: string;
  readonly port: number;
  readonly secret: string;
}

const TAIL = 12;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function describeExit(exit: ServerExit): string {
  if (exit.startError) return `could not start: ${exit.startError}`;
  return exit.signal ? `signal ${exit.signal}` : `code ${exit.code}`;
}

export function startServerChild(config: WhisperServerConfig, request: ServerChildRequest): ServerChild {
  const tail: string[] = [];
  let backend: 'gpu' | 'cpu' = config.gpu ? 'gpu' : 'cpu';
  let progress: ((fraction: number) => void) | undefined;
  let exit: ServerExit | undefined;
  const { port, secret, workDir } = request;
  const child = request.spawn({
    command: config.binary,
    args: whisperServerArgs(config, { port, secret, noPublic: join(workDir, 'no-public') }),
    cwd: workDir,
    onLine(line) {
      tail.push(line.slice(0, 300));
      if (tail.length > TAIL) tail.shift();
      if (gpuLine(line) === 'cpu') backend = 'cpu';
      const fraction = progressOf(line);
      if (fraction !== undefined) progress?.(fraction);
    },
  });
  const exited = child.exited.then((info) => (exit = info));
  return {
    pid: child.pid,
    exited,
    exit: () => exit,
    output: () => tail.join('\n'),
    backend: () => backend,
    onProgress(listener) {
      progress = listener;
    },
    async stop() {
      if (exit) return;
      child.kill('SIGTERM');
      const late = await Promise.race([exited.then(() => false), sleep(3000).then(() => true)]);
      if (late) child.kill('SIGKILL');
      await exited;
    },
  };
}
