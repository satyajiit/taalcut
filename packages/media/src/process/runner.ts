// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Runs a child process from an argument array (never a shell string), with a
 * capped stdout capture, a stderr tail, cancellation and a timeout. Generic on
 * purpose: ffmpeg, ffprobe and the test doubles all go through it.
 *
 * How a stopped run ends is the end policy's (end-policy.ts, IX3-K2): a run
 * that holds nothing gets SIGTERM, then SIGKILL after a grace period; a run
 * that may hold a hardware video session is asked to finish, sent one SIGTERM
 * where that is orderly, and never killed, and the caller stops waiting after
 * two grace periods while the process is tracked until it exits.
 *
 * The child runs in its own process group and signals go to the group, so
 * anything it started stops with it. Nothing that holds the pipes can keep
 * the runner waiting: it always settles a bounded time after exit or stop.
 */
import { err } from '@taalcut/core';
import { MediaCancelled } from '../errors';
import { DEFAULT_END_POLICY, type EndPolicy } from './end-policy';
import { ProcessRun } from './process-run';
import type { ProcessRunner } from './run-options';

export type { ProcessOutput, ProcessRunner, RunOptions } from './run-options';
export { DEFAULT_KILL_GRACE_MS, DEFAULT_MAX_STDOUT_BYTES, DEFAULT_STDERR_TAIL_BYTES } from './process-run';

/** A runner whose stops follow `policy`. */
export function createProcessRunner(policy: EndPolicy = DEFAULT_END_POLICY): ProcessRunner {
  return (command, args, options = {}) => {
    if (options.signal?.aborted)
      return Promise.resolve(err(MediaCancelled(undefined, { detail: 'aborted before start' })));
    return new Promise((resolve) => new ProcessRun(policy, command, args, options, resolve).start());
  };
}

export const runProcess: ProcessRunner = createProcessRunner();
