// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * How a process is ended (IX3-K2; IX3 design B, "No kill on VideoToolbox"). One policy for media's runner, its
 * JSON-lines sidecar client and everything that runs FFmpeg through them (vision, audio, render), decided from
 * what the run declares it may hold, never from its command line. The plan itself is core's `planProcessEnd`
 * (the tools sandbox uses it too); this adds where stalls go.
 *
 * Why: an h264_videotoolbox encode stuck in the Apple video encoder reset this Mac twice on 2026-10-17, each
 * time right after the stuck process was killed (`_orch/ix/logs/bench/vt-hang-2.md`). So a process that may
 * hold a hardware video session is asked to finish (FFmpeg's `q` on stdin, the mac helper's end of stdin), then
 * sent one SIGTERM where SIGTERM makes it finish in order, and is never SIGKILLed. Past a longer grace it is
 * reported once as a stall and left running; a hardware session lease held for it stays held until it exits.
 * Every other process keeps the escalation it always had: SIGTERM, then SIGKILL after a grace.
 */

import {
  DEFAULT_STALL_AFTER_MS,
  planProcessEnd,
  stallLine,
  type EndPlan,
  type ProcessStall,
  type ProgramStop,
  type RunHolding,
} from '@taalcut/core';

export {
  DEFAULT_STALL_AFTER_MS,
  FFMPEG_STOP,
  HELPER_STOP,
  PLAIN_STOP,
  scheduleEnd,
  type EndAction,
  type EndPlan,
  type EndStep,
  type ProcessStall,
  type ProgramStop,
  type RunHolding,
} from '@taalcut/core';

export interface EndPolicy {
  /** How to end a run that declared `run`, of a program that stops like `program`; `graceMs` spaces the steps. */
  plan(run: RunHolding, program: ProgramStop, graceMs: number): EndPlan;
  /** Reports one stall. */
  stalled(stall: ProcessStall): void;
}

export interface EndPolicyOptions {
  /** How long after the stop a process that may hold a video session is reported as a stall. Default 60 s. */
  readonly stallAfterMs?: number;
  /** Where stalls go. Default: one warning line on the console (the utility processes' log). */
  readonly onStall?: (stall: ProcessStall) => void;
}

/** The default stall sink: one line with the pid and the command, enough to `sample <pid>` it. */
export function logStall(stall: ProcessStall): void {
  console.warn(`[media] ${stallLine(stall)}`);
}

export function createEndPolicy(options: EndPolicyOptions = {}): EndPolicy {
  const stallAfterMs = options.stallAfterMs ?? DEFAULT_STALL_AFTER_MS;
  return {
    plan: (run, program, graceMs) => planProcessEnd(run, program, graceMs, stallAfterMs),
    stalled: options.onStall ?? logStall,
  };
}

/** The policy every runner and sidecar uses unless given another (stateless, so one is shared). */
export const DEFAULT_END_POLICY: EndPolicy = createEndPolicy();
