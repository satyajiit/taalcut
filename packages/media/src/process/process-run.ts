// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * One run of a child process for the runner (runner.ts): its output, its stop by the end policy (IX3-K2) and its
 * one result. Settle-scoped timers end with the result; a process the policy never kills keeps its own end steps
 * (unref'd) until it exits, so a stall is still reported after the caller moved on.
 */
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { basename } from 'node:path';
import type { Readable, Writable } from 'node:stream';
import { err, ok, ValidationError, type Result, type TaalcutError } from '@taalcut/core';
import { FfmpegNotFound, MediaCancelled, MediaTimeout, OutputTooLarge, SpawnFailed } from '../errors';
import { ByteTail } from './byte-tail';
import { sidecarEnv, signalGroup, USE_PROCESS_GROUPS } from './child-group';
import {
  PLAIN_STOP,
  scheduleEnd,
  type EndPlan,
  type EndPolicy,
  type EndStep,
  type ProgramStop,
} from './end-policy';
import type { ProcessOutput, RunOptions } from './run-options';
import { leftRunning, StopLog } from './stop-log';

export const DEFAULT_KILL_GRACE_MS = 2000;
export const DEFAULT_MAX_STDOUT_BYTES = 16 * 1024 * 1024;
export const DEFAULT_STDERR_TAIL_BYTES = 8 * 1024;

type StopReason = 'cancelled' | 'timeout' | 'output_too_large';
type RunResult = Result<ProcessOutput>;
type Child = ChildProcessByStdio<Writable, Readable, Readable>;

export class ProcessRun {
  private readonly started = Date.now();
  private readonly killGraceMs: number;
  private readonly maxStdout: number;
  private readonly stderr: ByteTail;
  private readonly program: ProgramStop;
  private readonly plan: EndPlan;
  private readonly log: StopLog;
  private readonly stdoutChunks: Buffer[] = [];
  /** Settle-scoped: cleared when the caller gets its result. */
  private readonly timers = new Set<NodeJS.Timeout>();
  /** Process-scoped: the end steps of a process that may outlive the result, cleared when it exits. */
  private readonly tracked = new Set<NodeJS.Timeout>();
  private stdoutBytes = 0;
  private stopReason: StopReason | undefined;
  private exited = false;
  private settled = false;
  private markExited: () => void = () => undefined;
  private readonly exitedPromise = new Promise<void>((done) => (this.markExited = done));
  private child: Child | undefined;
  private readonly onAbort = (): void => this.stop('cancelled');

  constructor(
    private readonly policy: EndPolicy,
    private readonly command: string,
    private readonly args: readonly string[],
    private readonly options: RunOptions,
    private readonly resolve: (result: RunResult) => void,
  ) {
    this.killGraceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
    this.maxStdout = options.maxStdoutBytes ?? DEFAULT_MAX_STDOUT_BYTES;
    this.stderr = new ByteTail(options.stderrTailBytes ?? DEFAULT_STDERR_TAIL_BYTES);
    this.program = options.program ?? PLAIN_STOP;
    const holding = { holdsVideoSession: options.holdsVideoSession === true };
    this.plan = policy.plan(holding, this.program, this.killGraceMs);
    this.log = new StopLog(command);
  }

  start(): void {
    const child = this.spawnChild();
    if (!child) return;
    this.child = child;
    if (child.pid !== undefined) this.options.onSpawn?.(child.pid);
    // A write to a stdin the child closed (it exited) is EPIPE here, not a crash; the outcome comes from 'exit'.
    child.stdin.on('error', () => undefined);
    if (!this.plan.steps.some((step) => step.action === 'ask')) child.stdin.end();
    this.options.signal?.addEventListener('abort', this.onAbort, { once: true });
    const { timeoutMs } = this.options;
    if (timeoutMs !== undefined && timeoutMs > 0)
      this.schedule('settle', timeoutMs, () => this.stop('timeout'));
    this.watchOutput(child);
    child.on('error', (cause: NodeJS.ErrnoException) => {
      // Spawn failures arrive here with no pid; errors after start (a failed kill) are not fatal.
      if (child.pid !== undefined) return;
      this.settle(err(spawnError(this.command, cause)));
    });
    child.on('exit', () => this.onExit(child));
    child.on('close', (exitCode: number | null, exitSignal: string | null) => {
      this.settle(this.finished(exitCode, exitSignal));
    });
  }

  private spawnChild(): Child | undefined {
    try {
      return spawn(this.command, [...this.args], {
        shell: false,
        // stdin carries the program's own way out (FFmpeg's `q`); it is ended at once when the plan never asks.
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        // Leader of its own process group, so a stop reaches everything it starts.
        detached: USE_PROCESS_GROUPS,
        env: (this.options.env ?? sidecarEnv()) as NodeJS.ProcessEnv,
        ...(this.options.cwd ? { cwd: this.options.cwd } : {}),
      });
    } catch (cause) {
      // Synchronous throws are invalid arguments (e.g. a NUL byte in a path), not transient failures.
      const detail = cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);
      this.resolve(err(ValidationError({ field: 'args' }, { detail })));
      return undefined;
    }
  }

  private watchOutput(child: Child): void {
    child.stdout.on('data', (chunk: Buffer) => this.onStdout(chunk));
    child.stderr.on('data', (chunk: Buffer) => {
      if (this.settled) return;
      this.options.onStderr?.(chunk);
      this.stderr.push(chunk);
    });
    // Destroyed pipes can report errors; the outcome comes from 'close' or forceFinish.
    child.stdout.on('error', () => undefined);
    child.stderr.on('error', () => undefined);
  }

  private onStdout(chunk: Buffer): void {
    // A process left running after the result keeps writing: drained, never handed to a caller that moved on.
    if (this.settled) return;
    if (this.options.onStdout) {
      this.options.onStdout(chunk);
      return;
    }
    if (this.stopReason) return;
    if (this.stdoutBytes + chunk.length > this.maxStdout) {
      this.stop('output_too_large');
      return;
    }
    this.stdoutChunks.push(chunk);
    this.stdoutBytes += chunk.length;
  }

  private onExit(child: Child): void {
    this.exited = true;
    this.markExited();
    child.stdin.destroy();
    for (const timer of this.tracked) clearTimeout(timer);
    this.tracked.clear();
    // 'close' waits for every holder of the pipes. Something the child started may keep them open after it
    // exits; give it the grace period, then end what is left (where the plan may kill) or stop waiting.
    if (!this.plan.mayKill) this.schedule('settle', this.killGraceMs, () => this.letPipesGo());
    else if (!this.stopReason) this.schedule('settle', this.killGraceMs, () => this.forceFinish());
  }

  /**
   * A timer of the result (`settle`: cleared when the caller gets its result) or of the process (`process`:
   * an end step of a process that may outlive the result, unref'd and cleared when it exits).
   */
  private schedule(scope: 'settle' | 'process', ms: number, fn: () => void): void {
    const timers = scope === 'settle' ? this.timers : this.tracked;
    if (scope === 'settle' ? this.settled : this.exited) return;
    const timer = setTimeout(() => {
      timers.delete(timer);
      fn();
    }, ms);
    if (scope === 'process') timer.unref();
    timers.add(timer);
  }

  private settle(result: RunResult): void {
    if (this.settled) return;
    this.settled = true;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    this.options.signal?.removeEventListener('abort', this.onAbort);
    this.resolve(result);
  }

  private stopped(how: string): RunResult {
    const detail = this.log.detail(this.stopReason, how, this.stderr.text());
    return err(stopError(this.stopReason ?? 'cancelled', this.options, this.maxStdout, detail));
  }

  private finished(exitCode: number | null, exitSignal: string | null): RunResult {
    if (this.stopReason)
      return this.stopped(exitSignal ? `signal ${exitSignal}` : `exit code ${String(exitCode)}`);
    return ok({
      exitCode,
      signal: exitSignal,
      stdout: Buffer.concat(this.stdoutChunks),
      stderrTail: this.stderr.text(),
      durationMs: Date.now() - this.started,
    });
  }

  /** Stops waiting for the pipes: once the child has exited, 'close' then settles normally. */
  private letPipesGo(): void {
    const child = this.child;
    if (!child) return;
    child.stdout.destroy();
    child.stderr.destroy();
    if (this.exited)
      this.schedule('settle', 100, () => this.settle(this.finished(child.exitCode, child.signalCode)));
  }

  /**
   * Kills whatever is left in the group, then stops waiting for the pipes. A child stuck in uninterruptible
   * I/O (a dead network volume) never closes them, so settle without it. Only for a plan that may kill.
   */
  private forceFinish(): void {
    if (this.child) signalGroup(this.child, 'SIGKILL');
    this.schedule('settle', this.killGraceMs, () => {
      this.letPipesGo();
      if (!this.exited) this.settle(this.stopped('nothing: gave up waiting after SIGKILL'));
    });
  }

  private stop(reason: StopReason): void {
    if (this.stopReason || this.settled) return;
    this.stopReason = reason;
    const steps = {
      ask: () => this.ask(),
      terminate: (step: EndStep) => this.terminate(step),
      kill: () => this.kill(),
      release: (step: EndStep) => this.release(step),
      stall: (step: EndStep) => this.stall(step),
    };
    scheduleEnd(this.plan, steps, (ms, fn) => {
      if (ms === 0) fn();
      else this.schedule(this.plan.mayKill ? 'settle' : 'process', ms, fn);
    });
  }

  private ask(): void {
    if (this.exited || !this.child) return;
    this.log.asked(this.program);
    if (typeof this.program.ask === 'object') this.child.stdin.write(this.program.ask.input);
    this.child.stdin.end();
  }

  private terminate(step: EndStep): void {
    // With nothing to kill afterwards, a group whose leader exited is left alone.
    if ((this.exited && !this.plan.mayKill) || !this.child) return;
    this.log.terminated(step.afterMs);
    signalGroup(this.child, 'SIGTERM');
  }

  private kill(): void {
    if (!this.exited) this.log.escalate(`; ignored SIGTERM, sent SIGKILL after ${this.killGraceMs} ms`);
    else if (this.child && signalGroup(this.child, 0))
      this.log.escalate(`; SIGKILL to processes it left behind after ${this.killGraceMs} ms`);
    this.forceFinish();
  }

  private release(step: EndStep): void {
    if (this.settled || this.exited) return;
    this.options.onOutlive?.(this.exitedPromise);
    this.settle(this.stopped(leftRunning(step.afterMs)));
  }

  private stall(step: EndStep): void {
    if (this.exited) return;
    this.policy.stalled({
      pid: this.child?.pid,
      command: this.command,
      args: this.args,
      reason: this.stopReason ?? 'cancelled',
      afterMs: step.afterMs,
    });
  }
}

function spawnError(command: string, cause: NodeJS.ErrnoException): TaalcutError {
  const detail = `${command}: ${cause.code ?? ''} ${cause.message}`.trim();
  if (cause.code === 'ENOENT' || cause.code === 'EACCES' || cause.code === 'ENOTDIR') {
    return FfmpegNotFound({ binary: basename(command) }, { detail });
  }
  return SpawnFailed(undefined, { detail });
}

function stopError(reason: StopReason, options: RunOptions, maxStdout: number, detail: string): TaalcutError {
  if (reason === 'timeout') return MediaTimeout({ ms: options.timeoutMs ?? 0 }, { detail });
  if (reason === 'output_too_large') return OutputTooLarge({ limitBytes: maxStdout }, { detail });
  return MediaCancelled(undefined, { detail });
}
