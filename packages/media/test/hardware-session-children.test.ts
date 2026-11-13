// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A slot names the processes that hold its session (IX3-F5 H4, IX3-F7): FFmpeg runs detached and the mac helper
 * outlives a request, so a quit (`process.exit`) or a crash of the utility must not free the slot while one of them
 * may be in VideoToolbox. The pid is on disk before `adopt` returns; the start time (pid reuse) follows when `ps`
 * answers, and a pid with no start is kept while it lives. Gates with different pids on one folder stand for
 * different processes; `startOf` stands in for `ps`. The last tests start Node and a shell, never FFmpeg: nothing
 * here opens a VideoToolbox session.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, readdir, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ok } from '@taalcut/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createHardwareSessionGate,
  gateHardwareSessions,
  processStart,
  runProcess,
  type HardwareSessionGateOptions,
  type HardwareSessionLease,
  type ProcessRunner,
  type ProcessStart,
} from '@taalcut/media';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'taalcut-hw-children-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const HOLDER = 301;
const CHILD = 9001;
const STARTED = 'Tue Oct 21 09:00:00 2026';
const started = (at = STARTED): Promise<ProcessStart> => Promise.resolve({ kind: 'started', at });
const never = (): Promise<ProcessStart> => new Promise(() => undefined);
const unknown = (): Promise<ProcessStart> => Promise.resolve({ kind: 'unknown', detail: 'ps failed' });
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const slot = () => JSON.parse(readFileSync(join(dir, 'slot-0'), 'utf8')) as Record<string, unknown>;

const gate = (pid: number, options: Partial<HardwareSessionGateOptions> = {}) =>
  createHardwareSessionGate({
    dir,
    limit: 1,
    pid,
    isAlive: () => true,
    pollMs: 5,
    log: () => undefined,
    startOf: () => started(),
    ...options,
  });

/** The holder's lease on slot-0. */
const hold = async (options: Partial<HardwareSessionGateOptions> = {}): Promise<HardwareSessionLease> => {
  const lease = await gate(HOLDER, options).acquire(1);
  expect(lease).toMatchObject({ ok: true });
  return (lease as { value: HardwareSessionLease }).value;
};

/** The holder's heartbeat long stopped: what a quit or a crash leaves. */
async function holderGone(): Promise<void> {
  const old = new Date(Date.now() - 10 * 60_000);
  await utimes(join(dir, 'slot-0'), old, old);
}

/** Whether another process (which sees the holder dead) gets the slot within `ms`. */
async function takes(options: Partial<HardwareSessionGateOptions> = {}, ms = 80): Promise<boolean> {
  const ac = new AbortController();
  const waiting = gate(302, { staleMs: 10, isAlive: (pid) => pid !== HOLDER, ...options }).acquire(
    1,
    ac.signal,
  );
  const timer = setTimeout(() => ac.abort(), ms);
  const lease = await waiting;
  clearTimeout(timer);
  if (lease.ok) await lease.value.release();
  return lease.ok;
}

describe('session children (IX3-F5 H4, IX3-F7)', () => {
  it('has the pid on disk when adopt returns, before ps answers: a quit right after the spawn keeps the slot', async () => {
    const lease = await hold({ startOf: never });
    lease.adopt?.(CHILD);
    // Read before anything else runs: what a process.exit right here would leave.
    expect(slot()).toMatchObject({ pid: HOLDER, children: [{ pid: CHILD }] });
    expect(slot().children).toEqual([{ pid: CHILD }]);
    await holderGone();
    expect(await takes({ startOf: never })).toBe(false);
  });

  it('adds the start when ps answers, and frees the slot for a reused pid (a different start)', async () => {
    const lease = await hold();
    lease.adopt?.(CHILD);
    await tick(5);
    expect(slot().children).toEqual([{ pid: CHILD, started: STARTED }]);
    await holderGone();
    expect(await takes()).toBe(false);
    expect(await takes({ startOf: () => started('Tue Oct 21 10:30:00 2026') })).toBe(true);
  });

  it('keeps the pid with no start when ps fails, hangs or rejects, and keeps the slot while it lives', async () => {
    for (const startOf of [unknown, never, () => Promise.reject(new Error('spawn EAGAIN'))]) {
      const lease = await hold({ startOf });
      lease.adopt?.(CHILD);
      await tick(5);
      expect(slot().children).toEqual([{ pid: CHILD }]);
      await holderGone();
      expect(await takes()).toBe(false);
      expect(await takes({ isAlive: (pid) => pid !== HOLDER && pid !== CHILD })).toBe(true);
    }
  });

  it('logs an unreadable start once per gate, not at every spawn', async () => {
    const lines: string[] = [];
    const lease = await hold({ startOf: unknown, log: (line) => lines.push(line) });
    for (const pid of [CHILD, CHILD + 1, CHILD + 2]) lease.adopt?.(pid);
    await tick(5);
    expect(lines.filter((line) => line.includes('could not read when pid'))).toHaveLength(1);
    expect(slot().children).toEqual([{ pid: CHILD }, { pid: CHILD + 1 }, { pid: CHILD + 2 }]);
    await lease.release();
  });

  it('takes a child off when ps says it is gone and it is, or when it is forgotten', async () => {
    const gone = await hold({
      startOf: () => Promise.resolve({ kind: 'gone' }),
      isAlive: (pid) => pid !== CHILD,
    });
    gone.adopt?.(CHILD);
    expect(slot().children).toEqual([{ pid: CHILD }]);
    await tick(5);
    expect(slot().children).toBeUndefined();
    await gone.release();
    const lease = await hold({ startOf: never });
    lease.adopt?.(CHILD);
    lease.adopt?.(CHILD + 1);
    lease.forget?.(CHILD);
    expect(slot().children).toEqual([{ pid: CHILD + 1 }]);
    await lease.release();
  });

  it('writes nothing after release: no adopt, and no start that arrives late', async () => {
    let answer: (start: ProcessStart) => void = () => undefined;
    const slow = () => new Promise<ProcessStart>((resolve) => (answer = resolve));
    const lease = await hold({ startOf: slow });
    lease.adopt?.(CHILD);
    await lease.release();
    answer({ kind: 'started', at: STARTED });
    lease.adopt?.(CHILD + 1);
    await tick(5);
    expect((await readdir(dir)).filter((name) => !name.startsWith('.'))).toEqual([]);
  });

  it('logs a sweep that keeps a slot once per slot and child', async () => {
    const lease = await hold({ startOf: never });
    lease.adopt?.(CHILD);
    await holderGone();
    const lines: string[] = [];
    expect(await takes({ log: (line) => lines.push(line) })).toBe(false);
    expect(lines.filter((line) => line.includes(`child pid ${CHILD} runs`))).toHaveLength(1);
  });

  it("the gated runner names the run's child before it returns from the spawn", async () => {
    const seen: number[] = [];
    let atSpawn: unknown;
    const runner: ProcessRunner = async (_command, _args, options) => {
      options?.onSpawn?.(CHILD);
      atSpawn = slot().children;
      await tick(20);
      return ok({ exitCode: 0, signal: null, stdout: Buffer.alloc(0), stderrTail: '', durationMs: 1 });
    };
    const run = gateHardwareSessions(gate(HOLDER, { startOf: never }), runner);
    const result = await run('ffmpeg', ['-hwaccel', 'videotoolbox', '-i', 'in.mov', 'o.png'], {
      onSpawn: (pid) => seen.push(pid),
    });
    expect(result.ok).toBe(true);
    expect(seen).toEqual([CHILD]);
    expect(atSpawn).toEqual([{ pid: CHILD }]);
    expect(await readdir(dir)).not.toContain('slot-0');
  });
});

describe('a process and its start', () => {
  it('gives the runner the child pid once it starts', async () => {
    const pids: number[] = [];
    const run = await runProcess(process.execPath, ['-e', ''], { onSpawn: (pid) => pids.push(pid) });
    expect(run.ok).toBe(true);
    expect(pids).toHaveLength(1);
    expect(pids[0]).toBeGreaterThan(0);
  });

  it.skipIf(process.platform === 'win32')(
    'reads a running process start, and none for an exited one',
    async () => {
      const own = await processStart(process.pid);
      expect(own.kind).toBe('started');
      expect(await processStart(process.pid)).toEqual(own);
      const exited = spawnSync(process.execPath, ['-e', '']).pid;
      expect(await processStart(exited)).toEqual({ kind: 'gone' });
    },
  );

  it('says unknown on Windows, and when ps fails or times out (never gone)', async () => {
    expect(await processStart(process.pid, { platform: 'win32' })).toMatchObject({ kind: 'unknown' });
    expect(await processStart(process.pid, { ps: join(dir, 'no-such-ps') })).toMatchObject({
      kind: 'unknown',
    });
    const slowPs = join(dir, 'slow-ps');
    writeFileSync(slowPs, '#!/bin/sh\nexec sleep 5\n');
    chmodSync(slowPs, 0o755);
    expect(await processStart(process.pid, { ps: slowPs, timeoutMs: 100 })).toMatchObject({
      kind: 'unknown',
    });
  });
});
