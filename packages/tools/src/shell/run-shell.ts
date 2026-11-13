// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Runs one workspace shell command, confined (AGT2 sbx). The child leads its own process group. While it runs, the
 * watchdog sums the tree's resident memory and the disk poll sums the shell folder; the wall clock, either cap or a
 * cancel stops the tree: SIGTERM, then SIGKILL after the grace. When the command's shell exits, whatever it left
 * running (a background job, a server) is ended at once, so nothing outlives the call. Only processes this run
 * started are ever signalled (process-watch.ts).
 *
 * A non-zero exit is a result, and so is a limit: the call says which one stopped it, with the output so far.
 * The launcher's own refusal (a profile that doesn't load, bwrap without namespaces) is `sandbox.unavailable`.
 */
import { spawn } from 'node:child_process';
import { constants } from 'node:os';
import { CancelledError, err, ok, type AsyncResult } from '@taalcut/core';
import { SandboxUnavailable } from '../sandbox/errors';
import { folderBytes } from '../sandbox/paths';
import { confinedArgv, wrapperArgv, type ShellBackend } from './backend';
import { SHELL_KILL_GRACE_MS, SHELL_POLL_MS, type ShellLimits } from './limits';
import { headAndTail, tailOnly } from './output';
import { psProcesses, trackTree, type ListProcesses } from './process-watch';

export interface ShellRun {
  readonly backend: ShellBackend;
  readonly command: string;
  /** The folder the command starts in (the workspace's `work/`). */
  readonly cwd: string;
  /** The child's whole environment: nothing from ours leaks in. */
  readonly env: Readonly<Record<string, string>>;
  readonly limits: ShellLimits;
  /** The folder whose size is capped (the shell folder), and the cap. */
  readonly watch: { readonly dir: string; readonly maxBytes: number };
  readonly output: { readonly stdoutBytes: number; readonly stderrBytes: number };
  /** 1024 when the wrapper's sh is bash (macOS), 512 for dash. */
  readonly fileBlockBytes: number;
}

export const SHELL_STOPS = ['time', 'memory', 'disk', 'cpu', 'fileSize'] as const;
export type ShellStop = (typeof SHELL_STOPS)[number];

export interface ShellRunResult {
  /** The command's exit code; 128 + the signal's number when a signal ended it. */
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
  /** The limit that stopped it, or null when it ended by itself. */
  readonly stopped: ShellStop | null;
  /** The most resident memory the watchdog saw the tree use. */
  readonly peakMemoryBytes: number;
}

export interface ShellRunOptions {
  readonly signal?: AbortSignal;
  readonly now?: () => number;
  /** This user's processes (default `ps`). */
  readonly list?: ListProcesses;
  readonly pollMs?: number;
  readonly graceMs?: number;
  readonly onSpawn?: (pid: number) => void;
}

type Reason = ShellStop | 'abort';

const LAUNCHER_REFUSED = /^(sandbox-exec|bwrap): /;

export async function runShell(run: ShellRun, options: ShellRunOptions = {}): AsyncResult<ShellRunResult> {
  if (options.signal?.aborted) return err(CancelledError());
  const now = options.now ?? Date.now;
  const list = options.list ?? psProcesses();
  const pollMs = options.pollMs ?? SHELL_POLL_MS;
  const graceMs = options.graceMs ?? SHELL_KILL_GRACE_MS;
  const before = (await list()).length;
  if (options.signal?.aborted) return err(CancelledError());
  const started = now();
  const argv = wrapperArgv(
    {
      cpuSeconds: run.limits.cpuSeconds,
      maxFileBytes: run.limits.maxFileBytes,
      openFiles: run.limits.openFiles,
      processCap: before + run.limits.processes,
      fileBlockBytes: run.fileBlockBytes,
    },
    confinedArgv(run.backend, run.command),
  );
  const seccomp = run.backend.kind === 'bwrap' ? run.backend.seccomp : undefined;
  return new Promise((resolve) => {
    const child = spawn('/bin/sh', argv, {
      cwd: run.cwd,
      env: { ...run.env },
      detached: true,
      stdio: seccomp ? ['ignore', 'pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
    });
    if (seccomp) {
      const fd3 = child.stdio[3] as NodeJS.WritableStream | null;
      fd3?.on('error', () => undefined);
      fd3?.end(Buffer.from(seccomp));
    }
    const stdout = headAndTail(run.output.stdoutBytes);
    const stderr = tailOnly(run.output.stderrBytes);
    child.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk));

    const tree = child.pid !== undefined ? trackTree(child.pid, list) : undefined;
    if (child.pid !== undefined) options.onSpawn?.(child.pid);
    let reason: Reason | null = null;
    let peak = 0;
    let exited = false;
    const timers = new Set<NodeJS.Timeout>();
    const later = (ms: number, step: () => void) => {
      const timer = setTimeout(() => {
        timers.delete(timer);
        step();
      }, ms);
      timers.add(timer);
    };

    const stop = (why: Reason) => {
      if (reason !== null || exited) return;
      reason = why;
      void tree?.signal('SIGTERM');
      later(graceMs, () => void tree?.signal('SIGKILL'));
    };

    let polling = false;
    const poll = async () => {
      if (polling || !tree) return;
      polling = true;
      try {
        const sample = await tree.poll();
        peak = Math.max(peak, sample.rssBytes);
        if (sample.rssBytes > run.limits.memoryBytes) stop('memory');
        if ((await folderBytes(run.watch.dir)) > run.watch.maxBytes) stop('disk');
      } finally {
        polling = false;
      }
    };
    const initialWatch = setTimeout(() => void poll(), Math.min(50, pollMs));
    const watch = setInterval(() => void poll(), pollMs);
    const wall = setTimeout(() => stop('time'), run.limits.wallMs);
    const onAbort = () => stop('abort');
    options.signal?.addEventListener('abort', onAbort, { once: true });

    let done = false;
    const finish = async (code: number | null, signal: NodeJS.Signals | null, spawnError?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(initialWatch);
      clearInterval(watch);
      clearTimeout(wall);
      for (const timer of timers) clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      if (spawnError) return resolve(err(SandboxUnavailable(undefined, { detail: spawnError.message })));
      const durationMs = Math.max(0, now() - started);
      const exitCode = code ?? 128 + (signal ? (constants.signals[signal] ?? 0) : 0);
      const errText = stderr.text();
      if (reason === 'abort') return resolve(err(CancelledError()));
      if (reason === null && exitCode !== 0 && stdout.total === 0 && LAUNCHER_REFUSED.test(errText))
        return resolve(err(SandboxUnavailable(undefined, { detail: errText.slice(0, 1000) })));
      // The kernel's limits kill with SIGXCPU or SIGXFSZ: the command itself, or a child whose status the shell
      // passed on as 128 + the signal.
      const killedBy = (name: 'SIGXCPU' | 'SIGXFSZ') =>
        signal === name || exitCode === 128 + constants.signals[name];
      let stopped: ShellStop | null = reason;
      if (stopped === null && killedBy('SIGXCPU')) stopped = 'cpu';
      if (stopped === null && killedBy('SIGXFSZ')) stopped = 'fileSize';
      if (stopped === null && (await folderBytes(run.watch.dir)) > run.watch.maxBytes) stopped = 'disk';
      resolve(
        ok({ exitCode, stdout: stdout.text(), stderr: errText, durationMs, stopped, peakMemoryBytes: peak }),
      );
    };

    let closed = false;
    const pipesClosed = new Promise<void>((settle) =>
      child.once('close', () => {
        closed = true;
        settle();
      }),
    );
    child.once('error', (error) => void finish(null, null, error));
    child.once('exit', (code, signal) => {
      exited = true;
      clearTimeout(initialWatch);
      clearInterval(watch);
      // The command is over: end what it left behind, then wait (a little) for the pipes to close. A process that
      // escaped the tree before any poll saw it may still hold them: its pipes are let go.
      void (async () => {
        await tree?.signal('SIGKILL');
        let grace: NodeJS.Timeout | undefined;
        await Promise.race([pipesClosed, new Promise((settle) => (grace = setTimeout(settle, graceMs)))]);
        clearTimeout(grace);
        if (!closed) {
          child.stdout?.destroy();
          child.stderr?.destroy();
        }
        await finish(code, signal);
      })();
    });
    // onSpawn may cancel synchronously, before the abort listener was installed.
    if (options.signal?.aborted) onAbort();
  });
}
