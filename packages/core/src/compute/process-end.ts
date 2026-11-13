// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * How a child process is ended (IX3-K2): one pure plan for media's runner and sidecar client and the tools sandbox,
 * decided from what the run declares it may hold, never from its command line. An `h264_videotoolbox` encode stuck
 * in the Apple video encoder reset the development Mac twice, each time right after the stuck process was killed.
 * So a process that may hold a hardware video session is asked to finish, sent one SIGTERM where SIGTERM makes it
 * finish in order, and never SIGKILLed; long after the stop it is reported once as a stall and left running. Every
 * other process gets SIGTERM, then SIGKILL after a grace.
 */

/** What a run declares about itself. Its site knows what it asked the program to open. */
export interface RunHolding {
  /** The process may hold a hardware video session (VideoToolbox; NVDEC or NVENC on a Windows profile). */
  readonly holdsVideoSession: boolean;
}

/** How a program behaves when it is asked to stop: fixed per program, not per run. */
export interface ProgramStop {
  /** Text on its stdin (FFmpeg's `q`, unless it runs with `-nostdin`), the end of its stdin, or nothing. */
  readonly ask: { readonly input: string } | 'end-of-input' | 'none';
  /** SIGTERM makes it finish in order (FFmpeg traps it; its fourth signal is a hard exit, so it gets one). */
  readonly orderlySigterm: boolean;
}

/** FFmpeg reading stdin: `q`, then one SIGTERM, which it traps. */
export const FFMPEG_STOP: ProgramStop = { ask: { input: 'q' }, orderlySigterm: true };
/** The mac helper (and any JSON-lines sidecar): the end of stdin; it has no SIGTERM handler. */
export const HELPER_STOP: ProgramStop = { ask: 'end-of-input', orderlySigterm: false };
/** A program with no gentler way out than its signals. */
export const PLAIN_STOP: ProgramStop = { ask: 'none', orderlySigterm: false };

/**
 * One step, `afterMs` after the stop: `ask` (the program's own way out), `terminate` (one SIGTERM), `kill`
 * (SIGKILL), `release` (the caller stops waiting; the process stays tracked until it exits) and `stall` (one stall
 * report; the process is left running).
 */
export type EndAction = 'ask' | 'terminate' | 'kill' | 'release' | 'stall';

export interface EndStep {
  readonly afterMs: number;
  readonly action: EndAction;
}

export interface EndPlan {
  /** In time order. */
  readonly steps: readonly EndStep[];
  /** False: nothing may SIGKILL this process or its group, on any path (an executor's clean-up included). */
  readonly mayKill: boolean;
}

/** A process that may hold a hardware video session and has not exited long after it was asked to stop. */
export interface ProcessStall {
  readonly pid: number | undefined;
  readonly command: string;
  readonly args: readonly string[];
  /** Why it was being stopped: `cancelled`, `timeout`, `closed`, … */
  readonly reason: string;
  /** Time since the stop. */
  readonly afterMs: number;
}

/** A stuck encode sat at 0 % CPU for twelve minutes; a flush after `q` takes seconds. A minute tells them apart. */
export const DEFAULT_STALL_AFTER_MS = 60_000;

/** How to end a run that declared `run`, of a program that stops like `program`; `graceMs` spaces the steps. */
export function planProcessEnd(
  run: RunHolding,
  program: ProgramStop,
  graceMs: number,
  stallAfterMs: number = DEFAULT_STALL_AFTER_MS,
): EndPlan {
  if (!run.holdsVideoSession)
    return {
      mayKill: true,
      steps: [
        { afterMs: 0, action: 'terminate' },
        { afterMs: graceMs, action: 'kill' },
      ],
    };
  const asks = program.ask !== 'none';
  const steps: EndStep[] = asks ? [{ afterMs: 0, action: 'ask' }] : [];
  if (program.orderlySigterm) steps.push({ afterMs: asks ? graceMs : 0, action: 'terminate' });
  // As prompt for the caller as the escalation it replaces: SIGTERM, a grace, SIGKILL, another grace.
  const release = 2 * graceMs;
  steps.push({ afterMs: release, action: 'release' });
  steps.push({ afterMs: Math.max(stallAfterMs, release), action: 'stall' });
  return { mayKill: false, steps };
}

/** Each step's handler `afterMs` after now, through the executor's `schedule` (it decides what outlives what). */
export function scheduleEnd(
  plan: EndPlan,
  handlers: Readonly<Record<EndAction, (step: EndStep) => void>>,
  schedule: (afterMs: number, run: () => void) => void,
): void {
  for (const step of plan.steps) schedule(step.afterMs, () => handlers[step.action](step));
}

/** One log line for a stall: the pid and the command, enough to `sample <pid>` it. */
export function stallLine(stall: ProcessStall, maxArgs = 40): string {
  const args = stall.args.slice(0, maxArgs).join(' ');
  const more = stall.args.length > maxArgs ? ' …' : '';
  return (
    `stall: pid ${String(stall.pid)} (${stall.command} ${args}${more}) has not exited ` +
    `${Math.round(stall.afterMs / 1000)} s after it was stopped (${stall.reason}); it may hold a hardware video ` +
    'session, so it is left running and never killed'
  );
}
