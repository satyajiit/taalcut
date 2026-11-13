// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX3-K2 with small Node children standing for FFmpeg (never a real VideoToolbox session): a run that may hold a
 * video session is asked with `q` on stdin, sent one SIGTERM, never SIGKILLed, and the caller still gets its
 * `media.cancelled` (or `media.timeout`) two graces after the stop; the process is tracked until it exits
 * (`onOutlive`) and reported once as a stall. A run that holds nothing still escalates to SIGKILL.
 *
 * The runner's timers (the timeout, the plan's graces, the stall) run on Vitest's clock, and each test moves it only
 * once the stand-in has shown what the last step did to it (its notes, waited for as they arrive). So no answer
 * depends on how fast a loaded machine starts Node or delivers a signal (IX3-F1): under a full `pnpm test`, a timeout
 * on the real clock could send its SIGTERM before the stand-in's handler was in place, and the stand-in died of it
 * (FFmpeg's own handler is in place first thing).
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Result } from '@taalcut/core';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createEndPolicy,
  createProcessRunner,
  FFMPEG_STOP,
  PLAIN_STOP,
  type EndPolicyOptions,
  type ProcessOutput,
  type ProcessStall,
  type RunOptions,
} from '@taalcut/media';

const node = process.execPath;
const GRACE = 200;
const STALL_MS = 1500;
/** The real clock, kept before Vitest's is installed: the waits for the stand-in run on it. */
const realSetTimeout = globalThis.setTimeout;
const realPause = (ms: number) => new Promise<void>((resolve) => realSetTimeout(resolve, ms));
let dir: string;
const strays: number[] = [];

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'taalcut-vt-end-'));
});
beforeEach(() => {
  // Only the runner's timers: Date, I/O and the stand-in's own clock stay real.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});
afterEach(() => {
  vi.useRealTimers();
  // The stand-ins are plain Node processes, so the test may end them (never a real stuck session).
  for (const pid of strays.splice(0)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Already gone.
    }
  }
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** A stand-in that notes what reaches it (stdin bytes, its end, SIGTERM) in `mark`, then prints its pid. */
const standIn = (mark: string, onInput: string) => `
  const fs = require('node:fs');
  const note = (what) => fs.appendFileSync(${JSON.stringify(mark)}, what + '\\n');
  process.on('SIGTERM', () => note('sigterm'));
  process.stdin.on('data', (data) => { note('stdin:' + data); ${onInput} });
  process.stdin.on('end', () => note('eof'));
  setInterval(() => {}, 1000);
  process.stdout.write('ready ' + process.pid + '\\n');`;

/** Ignores q, the end of stdin and SIGTERM: a process stuck the way a VideoToolbox encode was. */
const stuck = (mark: string) => standIn(mark, '');
/** Finishes on q, as FFmpeg does. */
const obeysQ = (mark: string) => standIn(mark, "if (String(data).includes('q')) process.exit(255);");

const notes = (mark: string) =>
  readFile(mark, 'utf8').then(
    (text) => text.trim().split('\n'),
    () => [],
  );

/** The stand-in's notes once `done` holds for them, however long the machine takes to deliver them. */
async function notesWhen(mark: string, done: (seen: readonly string[]) => boolean): Promise<string[]> {
  for (;;) {
    const seen = await notes(mark);
    if (done(seen)) return seen;
    await realPause(10);
  }
}
const atLeast = (count: number) => (seen: readonly string[]) => seen.length >= count;
const lateNotes = (seen: readonly string[]) => seen.filter((what) => what === 'late').length;

interface Started {
  readonly pid: number;
  readonly result: Promise<Result<ProcessOutput>>;
  /** Whether the runner has answered its caller. */
  settled(): boolean;
}

/** Runs `code` in a stand-in and resolves once it says it is ready (its handlers are in place), clock unmoved. */
async function start(code: string, options: RunOptions, policy: EndPolicyOptions = {}): Promise<Started> {
  const runner = createProcessRunner(createEndPolicy(policy));
  let ready: (pid: number) => void = () => undefined;
  const readyPid = new Promise<number>((resolve) => (ready = resolve));
  let settled = false;
  const result = runner(node, ['-e', code], {
    killGraceMs: GRACE,
    ...options,
    onStdout: (chunk) => {
      const found = /ready (\d+)/.exec(chunk.toString());
      if (found) ready(Number(found[1]));
      options.onStdout?.(chunk);
    },
  });
  void result.then(() => (settled = true));
  const first = await Promise.race([readyPid.then((pid) => ({ pid })), result.then((answer) => ({ answer }))]);
  if (!('pid' in first)) throw new Error(`the stand-in ended before it was ready: ${JSON.stringify(first.answer)}`);
  strays.push(first.pid);
  return { pid: first.pid, result, settled: () => settled };
}

describe('a run that may hold a video session', { timeout: 60_000 }, () => {
  it('is asked with q, sent one SIGTERM a grace later, never killed, and the caller is released after two', async () => {
    const mark = join(dir, 'stuck.txt');
    const stalls: ProcessStall[] = [];
    const controller = new AbortController();
    let exited: Promise<void> | undefined;
    const run = await start(
      stuck(mark),
      {
        signal: controller.signal,
        holdsVideoSession: true,
        program: FFMPEG_STOP,
        onOutlive: (gone) => (exited = gone),
      },
      { stallAfterMs: STALL_MS, onStall: (stall) => stalls.push(stall) },
    );
    controller.abort();
    // At once: q, then the end of stdin.
    expect(await notesWhen(mark, atLeast(2))).toEqual(['stdin:q', 'eof']);
    // A grace later: one SIGTERM, and the caller still waits.
    await vi.advanceTimersByTimeAsync(GRACE);
    expect(await notesWhen(mark, atLeast(3))).toEqual(['stdin:q', 'eof', 'sigterm']);
    expect(run.settled()).toBe(false);
    // Two graces after the stop, as the escalation it replaces: answered, and the process left running.
    await vi.advanceTimersByTimeAsync(GRACE);
    const result = await run.result;
    expect(!result.ok && result.error.code).toBe('media.cancelled');
    const detail = (!result.ok && result.error.detail) || '';
    expect(detail).toContain(`stopped (cancelled) with q on stdin, then SIGTERM after ${GRACE} ms`);
    expect(detail).toContain('left running and never killed');
    expect(detail).not.toContain('SIGKILL');
    expect(stalls).toEqual([]);
    expect(exited).toBeDefined();
    expect(alive(run.pid)).toBe(true);

    // At the stall grace: reported once, with its pid and command. Then the plan has nothing left to send.
    await vi.advanceTimersByTimeAsync(STALL_MS - 2 * GRACE);
    expect(stalls).toEqual([
      expect.objectContaining({ pid: run.pid, command: node, reason: 'cancelled', afterMs: STALL_MS }),
    ]);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(stalls).toHaveLength(1);
    expect(alive(run.pid)).toBe(true);
    expect(await notes(mark)).toEqual(['stdin:q', 'eof', 'sigterm']);

    // It is tracked until it really exits (here the test ends the stand-in).
    let gone = false;
    void exited?.then(() => (gone = true));
    await realPause(50);
    expect(gone).toBe(false);
    process.kill(run.pid, 'SIGKILL');
    await exited;
    expect(gone).toBe(true);
  });

  it('ends on its q alone when it obeys, before any grace, with no signal and no stall', async () => {
    const mark = join(dir, 'obeys.txt');
    const stalls: ProcessStall[] = [];
    const controller = new AbortController();
    let outlived = false;
    const run = await start(
      obeysQ(mark),
      {
        signal: controller.signal,
        holdsVideoSession: true,
        program: FFMPEG_STOP,
        onOutlive: () => (outlived = true),
      },
      { stallAfterMs: 300, onStall: (stall) => stalls.push(stall) },
    );
    controller.abort();
    // Answered on its own exit with the clock unmoved: no grace was needed.
    const result = await run.result;
    expect(!result.ok && result.error.code).toBe('media.cancelled');
    expect(!result.ok && result.error.detail).toMatch(/with q on stdin, ended by exit code 255/);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(outlived).toBe(false);
    expect(stalls).toEqual([]);
    expect(await notes(mark)).toEqual(['stdin:q']);
  });

  it('times out the same way: media.timeout, never killed', async () => {
    const mark = join(dir, 'timeout.txt');
    // The timeout counts from spawn: on this clock it can't run out before the stand-in is ready.
    const run = await start(stuck(mark), { holdsVideoSession: true, program: FFMPEG_STOP, timeoutMs: 4000 });
    await vi.advanceTimersByTimeAsync(3999);
    expect(run.settled()).toBe(false);
    expect(await notes(mark)).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(await notesWhen(mark, atLeast(2))).toEqual(['stdin:q', 'eof']);
    await vi.advanceTimersByTimeAsync(GRACE);
    expect(await notesWhen(mark, atLeast(3))).toEqual(['stdin:q', 'eof', 'sigterm']);
    expect(run.settled()).toBe(false);
    await vi.advanceTimersByTimeAsync(GRACE);
    const result = await run.result;
    expect(!result.ok && result.error).toMatchObject({ code: 'media.timeout', params: { ms: 4000 } });
    expect(!result.ok && result.error.detail).toContain(
      `stopped (timeout) with q on stdin, then SIGTERM after ${GRACE} ms`,
    );
    expect(alive(run.pid)).toBe(true);
  });

  it('gets no signal at all when its program can be neither asked nor terminated in order', async () => {
    const mark = join(dir, 'plain.txt');
    const controller = new AbortController();
    const run = await start(stuck(mark), {
      signal: controller.signal,
      holdsVideoSession: true,
      program: PLAIN_STOP,
    });
    // stdin ends at the start, as for any run the plan never asks.
    expect(await notesWhen(mark, atLeast(1))).toEqual(['eof']);
    controller.abort();
    await vi.advanceTimersByTimeAsync(2 * GRACE);
    const result = await run.result;
    expect(!result.ok && result.error.detail).toMatch(/with nothing, ended by nothing yet/);
    expect(alive(run.pid)).toBe(true);
    expect(await notes(mark)).toEqual(['eof']);
  });

  it('hands nothing it writes after the release to the caller', async () => {
    const mark = join(dir, 'chatty.txt');
    // From its SIGTERM on, it writes a frame and notes it every 20 ms of its own clock.
    const code = `${stuck(mark)}
      process.on('SIGTERM', () => setInterval(() => { process.stdout.write('late frame\\n'); note('late'); }, 20));`;
    const seen: string[] = [];
    const controller = new AbortController();
    const run = await start(code, {
      signal: controller.signal,
      holdsVideoSession: true,
      program: FFMPEG_STOP,
      onStdout: (chunk) => void seen.push(chunk.toString()),
    });
    controller.abort();
    await vi.advanceTimersByTimeAsync(GRACE);
    await notesWhen(mark, (notesNow) => lateNotes(notesNow) >= 1);
    await vi.advanceTimersByTimeAsync(GRACE);
    expect((await run.result).ok).toBe(false);
    const handed = seen.length;
    // Three more frames written after the answer: none reaches the caller.
    const writtenByThen = lateNotes(await notes(mark));
    await notesWhen(mark, (notesNow) => lateNotes(notesNow) >= writtenByThen + 3);
    expect(seen.length).toBe(handed);
  });
});

describe('a run that holds nothing', { timeout: 60_000 }, () => {
  it('still escalates to SIGKILL a grace after its SIGTERM, and gets no q', async () => {
    const mark = join(dir, 'plain-run.txt');
    const controller = new AbortController();
    const run = await start(stuck(mark), {
      signal: controller.signal,
      holdsVideoSession: false,
      program: FFMPEG_STOP,
    });
    // Nothing to ask with: its stdin ends at the start.
    expect(await notesWhen(mark, atLeast(1))).toEqual(['eof']);
    controller.abort();
    // SIGTERM at once; it ignores it, and the runner waits out the grace.
    expect(await notesWhen(mark, atLeast(2))).toEqual(['eof', 'sigterm']);
    expect(run.settled()).toBe(false);
    expect(alive(run.pid)).toBe(true);
    await vi.advanceTimersByTimeAsync(GRACE);
    const result = await run.result;
    expect(!result.ok && result.error.detail).toContain(
      `stopped (cancelled) with SIGTERM, ended by signal SIGKILL; ignored SIGTERM, sent SIGKILL after ${GRACE} ms`,
    );
    expect(alive(run.pid)).toBe(false);
    expect(await notes(mark)).toEqual(['eof', 'sigterm']);
  });
});
