// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A ProcessRunner that holds hardware sessions for the commands that open
 * them. Put it in `MediaContext.runner` and every FFmpeg call of media,
 * vision, audio and render (they all run through `ctx.runner`) waits for a
 * slot first; CPU-only commands and ffprobe pass straight through.
 */
import { ok, type AsyncResult } from '@taalcut/core';
import type { MediaContext } from '../ffmpeg';
import { runProcess, type ProcessRunner } from '../process/runner';
import type { HardwareSessionGate, HardwareSessionLease } from './types';
import { hardwareSessionWeight } from './weight';

const GATED = Symbol('taalcut.media.hardwareSessionsGated');

type GatedRunner = ProcessRunner & { readonly [GATED]?: true };

/**
 * Wraps `runner` (default `runProcess`). A runner that is already gated is
 * returned as it is: holding a slot and then waiting for another one inside
 * the same call could wait forever.
 */
export function gateHardwareSessions(
  gate: HardwareSessionGate,
  runner: ProcessRunner = runProcess,
): ProcessRunner {
  if ((runner as GatedRunner)[GATED]) return runner;
  const gated: ProcessRunner = async (command, args, options = {}) => {
    const weight = hardwareSessionWeight(args);
    if (weight === 0) return runner(command, args, options);
    const lease = await gate.acquire(weight, options.signal);
    if (!lease.ok) return lease;
    let outlived: Promise<void> | undefined;
    const onOutlive = (exited: Promise<void>): void => {
      outlived = exited;
      options.onOutlive?.(exited);
    };
    // The slot names the child before this returns to the event loop (run detached, it may outlive this process
    // through a quit or a crash): held while it runs (IX3-F5 H4, IX3-F7).
    const onSpawn = (pid: number): void => {
      lease.value.adopt?.(pid);
      options.onSpawn?.(pid);
    };
    try {
      return await runner(command, args, { ...options, onOutlive, onSpawn });
    } finally {
      // A process left running past its stop (it may hold a video session: never killed) keeps its sessions
      // until it exits (IX3-K2), so the cap still counts what the hardware really has open.
      if (outlived) releaseWhenExited(lease.value, outlived);
      else await lease.value.release();
    }
  };
  return Object.assign(gated, { [GATED]: true as const });
}

/**
 * Gives back a lease once `exited` resolves (what holds its sessions is gone); a failure to remove the slot file
 * is logged (it goes stale).
 */
export function releaseWhenExited(lease: HardwareSessionLease, exited: Promise<void>): void {
  void exited.then(() => giveBack(lease));
}

/** Gives back a lease now; a failure to remove the slot file is logged (it goes stale). */
export function giveBack(lease: Pick<HardwareSessionLease, 'release'>): Promise<void> {
  return lease.release().catch((cause: unknown) => {
    console.error(
      '[media] could not give back a hardware session lease; it is swept when it goes stale',
      cause,
    );
  });
}

/**
 * `wrapper` (which calls `inner`) marked gated when `inner` is, so wrapping a
 * gated runner (to count its commands) never makes the gate apply twice.
 */
export function keepGate(inner: ProcessRunner, wrapper: ProcessRunner): ProcessRunner {
  return (inner as GatedRunner)[GATED] ? Object.assign(wrapper, { [GATED]: true as const }) : wrapper;
}

/** The two MediaContext fields that apply the gate: the gated runner, and the gate for spawns outside it. */
export function hardwareSessionContext(
  gate: HardwareSessionGate,
  runner?: ProcessRunner,
): Pick<MediaContext, 'runner' | 'hardwareSessions'> {
  return { runner: gateHardwareSessions(gate, runner), hardwareSessions: gate };
}

const NOTHING_HELD: HardwareSessionLease = { weight: 0, release: () => Promise.resolve() };

/**
 * The gate for a program run some other way than a ProcessRunner (the tools
 * sandbox's confined children): holds the sessions its arguments open until
 * the caller releases, and nothing for a CPU-only run.
 */
export function hardwareSessionsFor(
  gate: HardwareSessionGate,
): (program: string, args: readonly string[], signal?: AbortSignal) => AsyncResult<HardwareSessionLease> {
  return (_program, args, signal) => {
    const weight = hardwareSessionWeight(args);
    return weight === 0 ? Promise.resolve(ok(NOTHING_HELD)) : gate.acquire(weight, signal);
  };
}
