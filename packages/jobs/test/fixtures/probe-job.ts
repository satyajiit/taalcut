// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Job kinds declared the way @taalcut/media declares its own (core's
 * defineJobKind and JobHandler; camelCase kinds; io and gpu classes), with
 * handlers that run a fake ffprobe process. packages/jobs may not import
 * media (PRD 6.2 layering, tests included), so these stand in for
 * `createMediaJobs`; the contract they exercise is the same.
 *
 * The fake ffprobe writes its pid, waits for a release file, then prints a
 * probe result; with a fail-once file it fails once first (a retryable error).
 */
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CancelledError,
  defineJobKind,
  err,
  ok,
  TimeoutError,
  type AsyncResult,
  type JobHandler,
} from '@taalcut/core';
import { z } from 'zod';

export const READING_STAGE = 'jobs.stage.readingMediaInfo';

export const probeKind = defineJobKind({
  kind: 'test.probeMedia',
  input: z.object({ path: z.string().min(1) }),
  output: z.object({ path: z.string(), durationSeconds: z.number().positive() }),
  resource: 'io',
  priority: 'high',
  retry: { maxAttempts: 2, backoff: { kind: 'fixed', delayMs: 10 } },
  timeoutMs: 60_000,
  idempotencyKey: (input) => `test.probeMedia:${input.path}`,
});

/** Same shape as probeKind, but the handler's output breaks the schema. */
export const brokenProbeKind = defineJobKind({ ...probeKind, kind: 'test.brokenProbe' });

/** A GPU job, like media.extractFrame: serialised by the default gpu limit of 1. */
export const frameKind = defineJobKind({
  kind: 'test.extractFrame',
  input: z.object({ path: z.string().min(1), n: z.int() }),
  output: z.object({ n: z.int() }),
  resource: 'gpu',
  priority: 'high',
});

export interface FakeFfprobe {
  readonly dir: string;
  readonly script: string;
  /** Written by the fake process with its pid once it is running. */
  readonly pidfile: string;
  /** While this file is missing the fake process keeps running. */
  readonly release: string;
  /** If present, the next run deletes it and fails. */
  readonly failOnce: string;
}

// The pid file appears whole (a rename), never empty: `echo $$ > file` creates the file before it writes the pid, and
// a test that read it in between got 0, which process.kill(0, 0) answers for the whole process group, so "the fake
// ffprobe to stop" waited out its patience (UX2-FIXUP; it failed alone, not only under load).
const SCRIPT = `#!/bin/sh
if [ -f "$FAIL_ONCE" ]; then rm -f "$FAIL_ONCE"; echo "ffprobe: resource temporarily unavailable" >&2; exit 1; fi
echo $$ > "$PIDFILE.part" && mv "$PIDFILE.part" "$PIDFILE"
while [ ! -f "$RELEASE" ]; do sleep 0.02; done
printf '{"format":{"duration":"2.002000"}}'
`;

/** The fake ffprobe's files in `dir` (written by `writeFakeFfprobe`). */
export function fakeFfprobeIn(dir: string): FakeFfprobe {
  return {
    dir,
    script: join(dir, 'ffprobe'),
    pidfile: join(dir, 'ffprobe.pid'),
    release: join(dir, 'release'),
    failOnce: join(dir, 'fail-once'),
  };
}

export function writeFakeFfprobe(dir: string): FakeFfprobe {
  const fake = fakeFfprobeIn(dir);
  writeFileSync(fake.script, SCRIPT);
  chmodSync(fake.script, 0o755);
  return fake;
}

export function release(fake: FakeFfprobe): void {
  writeFileSync(fake.release, '');
}

export function fakeIsRunning(fake: FakeFfprobe): boolean {
  return existsSync(fake.pidfile);
}

/** Runs the fake ffprobe on `path`; aborting kills it. A failed run is a retryable timeout, like media's. */
function runFake(fake: FakeFfprobe, path: string, signal: AbortSignal): AsyncResult<string> {
  return new Promise((resolve) => {
    const env = {
      PATH: process.env.PATH,
      PIDFILE: fake.pidfile,
      RELEASE: fake.release,
      FAIL_ONCE: fake.failOnce,
    };
    const child = spawn(fake.script, [path], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
    const onAbort = () => child.kill('SIGTERM');
    signal.addEventListener('abort', onAbort, { once: true });
    // A busy machine can refuse the spawn (EAGAIN): a retryable failure, like media's spawn_failed.
    child.on('error', (cause) => {
      signal.removeEventListener('abort', onAbort);
      resolve(err(TimeoutError(undefined, { detail: `spawn: ${cause.message}` })));
    });
    child.on('close', (code) => {
      signal.removeEventListener('abort', onAbort);
      if (signal.aborted) resolve(err(CancelledError()));
      else if (code === 0) resolve(ok(stdout));
      else resolve(err(TimeoutError(undefined, { detail: stderr.trim() })));
    });
  });
}

type ProbeInput = z.output<typeof probeKind.input>;
type ProbeOutput = z.output<typeof probeKind.output>;

export function probeHandler(fake: FakeFfprobe): JobHandler<ProbeInput, ProbeOutput> {
  return async (input, context) => {
    context.progress({ fraction: 0, stageKey: READING_STAGE });
    const printed = await runFake(fake, input.path, context.signal);
    if (!printed.ok) return printed;
    const duration = Number((JSON.parse(printed.value) as { format: { duration: string } }).format.duration);
    context.progress({ fraction: 1 });
    return ok({ path: input.path, durationSeconds: duration });
  };
}

/** Returns a result its kind's output schema rejects (a negative duration). */
export function brokenProbeHandler(): JobHandler<ProbeInput, ProbeOutput> {
  return async (input) => ok({ path: input.path, durationSeconds: -1 });
}
