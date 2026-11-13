// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX3-K2 in the sandbox: a run that may hold a hardware video session (the sandbox's FFmpeg) gets one SIGTERM and
 * is never SIGKILLed; its caller is answered after two graces, a stall is reported with its pid, and its hardware
 * session lease is held until it exits. Any other run still gets SIGKILL after the grace. The child here is a
 * stand-in, never FFmpeg: `/bin/sh` takes sandbox-exec's place and runs a script (in the profile's place) that
 * ignores SIGTERM, says it is ready on stdout, and sleeps. Only the test itself kills it, at the end.
 *
 * Each test stops the run once the stand-in has said so (its output line, an event), not after a time: under a
 * full `pnpm test` a shell can take longer to start than any fixed wait (IX3-F1). Timings count from the stop.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_SANDBOX_LIMITS, ok, type ProcessStall, type Result } from '@taalcut/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runConfined, type ConfinedRun } from '../src/sandbox/runner';
import { execSandbox, experimentId, findFfmpeg, tempRoot } from './helpers/sandbox';

let temp: { root: string; cleanup: () => void };
let script: string;
const started: number[] = [];
beforeEach(() => {
  temp = tempRoot();
  mkdirSync(join(temp.root, 'profiles'));
  // In the profile's place: `sandbox-exec -f <profile> …` becomes `/bin/sh -f <script> …`. SIGTERM is ignored
  // before the ready line, so a stop that follows the line always finds it ignored (and `exec` keeps it so).
  script = join(temp.root, 'profiles', 'offline.sb');
  writeFileSync(script, `trap '' TERM\necho "ready $$"\nexec /bin/sleep 120\n`);
});
afterEach(() => {
  // The stand-ins only: they sleep, they hold nothing.
  for (const pid of started.splice(0)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Already gone.
    }
  }
  temp.cleanup();
});

/** Signal 0 checks the pid without touching it: it throws once the process is gone. */
const signalZero = (pid: number) => () => process.kill(pid, 0);

/** Resolves with what `resolve` is called with. */
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

/** The stand-in's ready line, as an output listener and the pid it gives. */
function readiness() {
  const ready = deferred<number>();
  const onOutputLine = (stream: 'stdout' | 'stderr', line: string) => {
    const found = stream === 'stdout' ? /^ready (\d+)$/.exec(line) : null;
    if (found) ready.resolve(Number(found[1]));
  };
  return { onOutputLine, ready: ready.promise };
}

/**
 * Aborts once the stand-in is ready; returns its pid and when it was aborted. A run that ends before the ready line
 * fails here with what it answered, rather than as a wait that ran out.
 */
async function abortWhenReady(
  controller: AbortController,
  ready: Promise<number>,
  running: Promise<Result<unknown>>,
): Promise<{ pid: number; abortedAt: number }> {
  const first = await Promise.race([ready.then((pid) => ({ pid })), running.then((result) => ({ result }))]);
  if (!('pid' in first))
    throw new Error(`the stand-in ended before it was ready: ${JSON.stringify(first.result)}`);
  started.push(first.pid);
  const abortedAt = Date.now();
  controller.abort();
  return { pid: first.pid, abortedAt };
}

function standIn(holdsVideoSession: boolean): ConfinedRun {
  const scratch = join(temp.root, 'scratch');
  mkdirSync(scratch, { recursive: true });
  return {
    sandboxExec: '/bin/sh',
    profile: script,
    params: [],
    program: 'stand-in',
    args: [],
    cwd: scratch,
    env: { PATH: '/usr/bin:/bin' },
    limits: { ...DEFAULT_SANDBOX_LIMITS, wallMs: 60_000 },
    watch: { dir: scratch, maxBytes: 1024 ** 2 },
    holdsVideoSession,
    stop: { ask: 'none', orderlySigterm: true },
  };
}

// The stand-in's start is the only unbounded wait: the suite's budget covers a shell that a loaded machine starts late.
describe.skipIf(process.platform === 'win32')('ending a sandboxed run (IX3-K2)', { timeout: 120_000 }, () => {
  it('never SIGKILLs a run that may hold a video session; answers the caller, reports the stall', async () => {
    const controller = new AbortController();
    const stalls: ProcessStall[] = [];
    const stalled = deferred<void>();
    let exited: Promise<void> | undefined;
    const { onOutputLine, ready } = readiness();
    const running = runConfined(standIn(true), {
      signal: controller.signal,
      onOutputLine,
      stallAfterMs: 100,
      onStall: (stall) => {
        stalls.push(stall);
        stalled.resolve();
      },
      onOutlive: (exit) => (exited = exit),
    });
    const { pid, abortedAt } = await abortWhenReady(controller, ready, running);
    const result = await running;
    expect(!result.ok && result.error.code).toBe('core.cancelled');
    expect(Date.now() - abortedAt).toBeGreaterThanOrEqual(3900);
    expect(signalZero(pid)).not.toThrow();
    expect(exited).toBeInstanceOf(Promise);
    await stalled.promise;
    expect(stalls).toEqual([{ pid, command: 'stand-in', args: [], reason: 'abort', afterMs: 4000 }]);
    expect(signalZero(pid)).not.toThrow();
    process.kill(pid, 'SIGKILL');
    await exited;
  });

  it('still SIGKILLs a run that holds nothing, after the grace', async () => {
    const controller = new AbortController();
    const { onOutputLine, ready } = readiness();
    const running = runConfined(standIn(false), { signal: controller.signal, onOutputLine });
    const { pid, abortedAt } = await abortWhenReady(controller, ready, running);
    const result = await running;
    expect(!result.ok && result.error.code).toBe('core.cancelled');
    expect(Date.now() - abortedAt).toBeGreaterThanOrEqual(1900);
    expect(signalZero(pid)).toThrow();
  });

  const ffmpeg = findFfmpeg();
  it.skipIf('skip' in ffmpeg)(
    'holds the sandbox FFmpeg’s hardware session lease until it exits',
    async () => {
      let held = 0;
      const released = deferred<void>();
      const { sandbox } = execSandbox(join(temp.root, 'root'), {
        sandboxExec: '/bin/sh',
        profilesDir: join(temp.root, 'profiles'),
        hardwareSessions: () => {
          held++;
          const release = () => {
            held--;
            released.resolve();
            return Promise.resolve();
          };
          return Promise.resolve(ok({ release }));
        },
      });
      const id = experimentId();
      await sandbox.open({ id, projectId: null, purpose: 'analysis' });
      const controller = new AbortController();
      const tiny = ['-f', 'lavfi', '-i', 'color=red:size=64x64:duration=0.1', '-f', 'null', '-'];
      const { onOutputLine, ready } = readiness();
      const running = sandbox.run(
        id,
        { program: 'ffmpeg', args: tiny },
        { signal: controller.signal, onOutputLine },
      );
      const { pid } = await abortWhenReady(controller, ready, running);
      const result = await running;
      expect(!result.ok && result.error.code).toBe('core.cancelled');
      expect(signalZero(pid)).not.toThrow();
      expect(held).toBe(1);
      process.kill(pid, 'SIGKILL');
      // Released when the process exits, not before.
      await released.promise;
      expect(held).toBe(0);
    },
  );
});
