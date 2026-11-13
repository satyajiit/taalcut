// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Starts one confined child and watches it. The child always runs as
 *
 *   /bin/sh -c '<constant script>' sandbox <cpuSeconds> <fileKiB> /usr/bin/sandbox-exec -f <profile> -D … <program> <args…>
 *
 * The constant script only sets the CPU, file-size and open-file limits and
 * `exec`s the rest, so the shell never parses an argument. The child leads
 * its own process group: the wall clock, the experiment's size cap and a
 * cancel stop the whole group by core's end plan (IX3-K2): SIGTERM, then
 * SIGKILL after 2 s; a run that may hold a hardware video session (FFmpeg)
 * gets one SIGTERM and is never SIGKILLed: the caller is answered after two
 * graces, the process is left to exit and reported once as a stall.
 *
 * This module never validates: it is also the tests' way to run something
 * the validator would refuse and see the profile stop it.
 */
import { spawn } from 'node:child_process';
import { constants } from 'node:os';
import {
  CancelledError,
  err,
  ok,
  type AsyncResult,
  type ProcessStall,
  type ProgramStop,
  type SandboxLimits,
} from '@taalcut/core';
import { confinedEnd, type ConfinedEnd } from './ending';
import {
  SandboxCpuLimit,
  SandboxDiskLimit,
  SandboxProgramNotAllowed,
  SandboxTimeLimit,
  SandboxUnavailable,
} from './errors';
import { folderBytes } from './paths';

/** Sets the limits and replaces itself with the rest of its arguments. Never interpolated. */
export const WRAPPER_SCRIPT = 'ulimit -t "$1" && ulimit -f "$2" && ulimit -n 1024 && shift 2 && exec "$@"';
export const STDOUT_LIMIT = 64 * 1024;
export const STDERR_TAIL = 8 * 1024;
const DISK_POLL_MS = 500;

export interface ConfinedRun {
  readonly sandboxExec: string;
  readonly profile: string;
  readonly params: readonly (readonly [string, string])[];
  readonly program: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly limits: SandboxLimits;
  /** The folder whose size is capped, and the cap. */
  readonly watch: { readonly dir: string; readonly maxBytes: number };
  /** FFmpeg reports SIGXCPU itself and exits normally; its log line is the only trace. */
  readonly handlesCpuSignal?: boolean;
  /** The program may hold a hardware video session (IX3-K2): never SIGKILLed. Default false. */
  readonly holdsVideoSession?: boolean;
  /** How the program stops when asked (core's `ProgramStop`; stdin is closed, so it can't be asked). */
  readonly stop?: ProgramStop;
}

export interface ConfinedResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderrTail: string;
  readonly durationMs: number;
}

export interface ConfinedOptions {
  readonly signal?: AbortSignal;
  readonly onOutputLine?: (stream: 'stdout' | 'stderr', line: string) => void;
  readonly now?: () => number;
  /** A video-session run answered while it still runs: `exited` resolves at its exit (hold its lease until then). */
  readonly onOutlive?: (exited: Promise<void>) => void;
  /**
   * The child's pid once it started. The wrapper `exec`s sandbox-exec, which `exec`s the program, so it is the
   * program's pid (its lease records it, IX3-F5 H4).
   */
  readonly onSpawn?: (pid: number) => void;
  /** Where a stall goes (default: one console line); `stallAfterMs` defaults to core's 60 s. */
  readonly onStall?: (stall: ProcessStall) => void;
  readonly stallAfterMs?: number;
}

/** The wrapper's argv. `fileKiB` because macOS's sh counts `ulimit -f` in 1024-byte blocks. */
export function wrapperArgs(run: ConfinedRun): string[] {
  const cpu = String(Math.max(1, Math.ceil(run.limits.cpuSeconds)));
  const fileKiB = String(Math.max(1, Math.ceil(run.limits.maxFileBytes / 1024)));
  const defines = run.params.flatMap(([name, value]) => ['-D', `${name}=${value}`]);
  return [
    '-c',
    WRAPPER_SCRIPT,
    'sandbox',
    cpu,
    fileKiB,
    run.sandboxExec,
    '-f',
    run.profile,
    ...defines,
    run.program,
    ...run.args,
  ];
}

/** Collects output lines for `onOutputLine` without holding more than one partial line. */
function lineSplitter(emit: (line: string) => void) {
  let partial = '';
  return {
    push(chunk: string) {
      const lines = (partial + chunk).split('\n');
      partial = lines.pop()!.slice(-STDOUT_LIMIT);
      for (const line of lines) emit(line.replace(/\r$/, ''));
    },
    end() {
      if (partial) emit(partial);
      partial = '';
    },
  };
}

const SANDBOX_EXEC_DENIED = /^sandbox-exec: execvp\(\) of .* failed: Operation not permitted/;
const FFMPEG_CPU_SIGNAL = /received signal 24\b/;

export function runConfined(run: ConfinedRun, options: ConfinedOptions = {}): AsyncResult<ConfinedResult> {
  const now = options.now ?? Date.now;
  const started = now();
  if (options.signal?.aborted) return Promise.resolve(err(CancelledError()));
  return new Promise((resolve) => {
    const child = spawn('/bin/sh', wrapperArgs(run), {
      cwd: run.cwd,
      env: { ...run.env },
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    let stdoutBytes = 0;
    let stderr = Buffer.alloc(0);
    const ending = confinedEnd(child, run, options, () => void finish(null, null));
    const outLines = lineSplitter((line) => options.onOutputLine?.('stdout', line));
    const errLines = lineSplitter((line) => options.onOutputLine?.('stderr', line));
    if (child.pid !== undefined) options.onSpawn?.(child.pid);
    const wall = setTimeout(() => ending.stop('wall'), run.limits.wallMs);
    let checking = false;
    const disk = setInterval(() => {
      if (checking) return;
      checking = true;
      void folderBytes(run.watch.dir)
        .then((bytes) => {
          if (bytes > run.watch.maxBytes) ending.stop('disk');
        })
        .finally(() => (checking = false));
    }, DISK_POLL_MS);
    const onAbort = () => ending.stop('abort');
    options.signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout.on('data', (chunk: Buffer) => {
      if (stdoutBytes < STDOUT_LIMIT) stdout.push(chunk.subarray(0, STDOUT_LIMIT - stdoutBytes));
      stdoutBytes += chunk.length;
      if (options.onOutputLine) outLines.push(chunk.toString('utf8'));
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = Buffer.concat([stderr, chunk]);
      if (stderr.length > STDERR_TAIL * 2) stderr = stderr.subarray(stderr.length - STDERR_TAIL);
      if (options.onOutputLine) errLines.push(chunk.toString('utf8'));
    });

    let done = false;
    const finish = async (code: number | null, signal: NodeJS.Signals | null, spawnError?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(wall);
      clearInterval(disk);
      ending.answered();
      options.signal?.removeEventListener('abort', onAbort);
      outLines.end();
      errLines.end();
      if (spawnError) return resolve(err(SandboxUnavailable(undefined, { detail: spawnError.message })));
      const exit = { code, signal, stderrTail: tailText(stderr), stdout: Buffer.concat(stdout) };
      resolve(await confinedOutcome(run, ending.reason, exit, Math.max(0, now() - started)));
    };
    child.once('error', (error) => void finish(null, null, error));
    child.once('close', (code, signal) => void finish(code, signal));
  });
}

/** What a finished (or answered) run means: a limit it hit, sandbox-exec's refusal, or its exit. */
async function confinedOutcome(
  run: ConfinedRun,
  stopped: ConfinedEnd['reason'],
  exit: { code: number | null; signal: NodeJS.Signals | null; stderrTail: string; stdout: Buffer },
  durationMs: number,
): AsyncResult<ConfinedResult> {
  const { code, signal, stderrTail } = exit;
  if (stopped === 'abort') return err(CancelledError());
  if (stopped === 'wall')
    return err(SandboxTimeLimit({ ms: run.limits.wallMs }, { detail: stderrTail.slice(-500) }));
  const over = stopped === 'disk' || (await folderBytes(run.watch.dir)) > run.watch.maxBytes;
  if (over || signal === 'SIGXFSZ') {
    const bytes = over ? run.watch.maxBytes : run.limits.maxFileBytes;
    return err(SandboxDiskLimit({ bytes }, { detail: stderrTail.slice(-500) }));
  }
  if (signal === 'SIGXCPU' || (run.handlesCpuSignal && FFMPEG_CPU_SIGNAL.test(stderrTail)))
    return err(SandboxCpuLimit({ seconds: run.limits.cpuSeconds }));
  // sandbox-exec speaks only before the program starts, so its line comes first.
  if (code !== 0 && stderrTail.startsWith('sandbox-exec: ')) {
    return err(
      SANDBOX_EXEC_DENIED.test(stderrTail)
        ? SandboxProgramNotAllowed({ program: 'denied' }, { detail: stderrTail.slice(0, 500) })
        : SandboxUnavailable(undefined, { detail: stderrTail.slice(0, 500) }),
    );
  }
  const exitCode = code ?? 128 + (signal ? (constants.signals[signal] ?? 0) : 0);
  return ok({ exitCode, stdout: decode(exit.stdout), stderrTail, durationMs });
}

/** UTF-8 text, dropping a character cut in half at the end. */
function decode(bytes: Buffer): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes).replace(/�$/, '');
}

/** The last STDERR_TAIL bytes as text, starting on a character boundary. */
function tailText(bytes: Buffer): string {
  let start = Math.max(0, bytes.length - STDERR_TAIL);
  while (start < bytes.length && (bytes[start]! & 0xc0) === 0x80) start++;
  return bytes.subarray(start).toString('utf8');
}
