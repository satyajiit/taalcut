// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * One local model server process, as both drivers run it (llama-server.ts, mlx-server.ts): spawned through
 * SpawnPort on a free loopback port with a per-launch key, ready once `/health` answers 200, stopped with SIGTERM and
 * then SIGKILL after a grace. An exit before it is ready throws ExitedWhileLoading, with the last lines it printed
 * (the key scrubbed), so a driver can try again elsewhere; a failed start never leaves the process behind.
 */
import type { FetchFn } from '../client/http-meter';
import { scrubSecrets } from '../scrub';

export interface SidecarExit {
  readonly code: number | null;
  readonly signal: string | null;
}

export interface SidecarProcess {
  /** Settles once the process has exited for any reason; a failed spawn settles with code null. */
  readonly exited: Promise<SidecarExit>;
  kill(signal: 'SIGTERM' | 'SIGKILL'): void;
}

export interface SpawnRequest {
  readonly command: string;
  readonly args: readonly string[];
  /**
   * The child's whole environment. Don't merge process.env into it: llama.cpp
   * reads LLAMA_ARG_* variables, which would change the flags set here.
   */
  readonly env: Readonly<Record<string, string>>;
  /** stdout and stderr, line by line; the driver keeps the last few for a failure's detail. */
  readonly onOutput: (line: string) => void;
}

/** Starts a native process. The desktop main process implements it with child_process.spawn. */
export interface SpawnPort {
  spawn(request: SpawnRequest): SidecarProcess;
}

/** The process exited before /health said ok: worth one more try (llama.cpp: on the CPU). */
export class ExitedWhileLoading extends Error {}

export interface SidecarStart {
  readonly spawn: SpawnPort;
  readonly fetch: FetchFn;
  /** For messages: 'llama-server', 'taalcut-mlx-server'. */
  readonly name: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly port: number;
  readonly apiKey: string;
  readonly signal: AbortSignal;
  readonly startTimeoutMs: number;
  readonly healthIntervalMs: number;
  readonly stopGraceMs: number;
}

export interface ServingSidecar {
  /** `http://127.0.0.1:<port>`. */
  readonly origin: string;
  readonly exited: Promise<SidecarExit>;
  /** Set once it has exited. */
  exit(): SidecarExit | undefined;
  stop(): Promise<void>;
}

const TAIL_LINES = 12;

/** Spawns the server and resolves once it is ready; throws (after stopping it) when it isn't. */
export async function startSidecar(start: SidecarStart): Promise<ServingSidecar> {
  const tail: string[] = [];
  const child = start.spawn.spawn({
    command: start.command,
    args: start.args,
    env: start.env,
    onOutput: (line) => {
      tail.push(line.slice(0, 300));
      if (tail.length > TAIL_LINES) tail.shift();
    },
  });
  let exit: SidecarExit | undefined;
  const exited = child.exited.then((info) => (exit = info));
  const origin = `http://127.0.0.1:${start.port}`;
  const output = () => scrubSecrets(tail.join('\n'), [start.apiKey]);
  const stop = async () => {
    if (exit) return;
    child.kill('SIGTERM');
    const grace = new Promise<'late'>((resolve) =>
      setTimeout(() => resolve('late'), start.stopGraceMs).unref?.(),
    );
    if ((await Promise.race([exited, grace])) === 'late') child.kill('SIGKILL');
    await exited;
  };

  const healthy = async (): Promise<boolean> => {
    try {
      const response = await start.fetch(`${origin}/health`, {
        headers: { Authorization: `Bearer ${start.apiKey}` },
        signal: AbortSignal.any([start.signal, AbortSignal.timeout(2_000)]),
      });
      await response.body?.cancel();
      return response.ok;
    } catch {
      return false; // Not listening yet.
    }
  };

  try {
    const deadline = Date.now() + start.startTimeoutMs;
    for (;;) {
      if (start.signal.aborted) throw new Error(`${start.name} start was cancelled.`);
      if (exit)
        throw new ExitedWhileLoading(
          `${start.name} exited (${describeExit(exit)}) while loading.\n${output()}`,
        );
      if (Date.now() > deadline)
        throw new Error(`${start.name} was not ready after ${start.startTimeoutMs} ms.\n${output()}`);
      if (await healthy()) break;
      await Promise.race([exited, sleep(start.healthIntervalMs)]);
    }
  } catch (cause) {
    await stop();
    throw cause;
  }
  return { origin, exited, exit: () => exit, stop };
}

export function describeExit(exit: SidecarExit): string {
  return exit.signal ? `signal ${exit.signal}` : `code ${exit.code}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
