// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The cross-process hardware session gate. Gates with different pids on one
 * folder stand for different processes (the folder is all they share); one
 * test holds a slot from a real child process and kills it. Nothing here
 * opens a VideoToolbox session.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHardwareSessionGate, type HardwareSessionGateOptions } from '@taalcut/media';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'taalcut-hw-gate-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const gate = (pid: number, options: Partial<HardwareSessionGateOptions> = {}) =>
  createHardwareSessionGate({
    dir,
    limit: 2,
    pid,
    isAlive: () => true,
    pollMs: 5,
    log: () => undefined,
    ...options,
  });

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

describe('hardware session gate', () => {
  it('never holds more sessions than the limit across processes', async () => {
    const gates = [gate(201, { limit: 4 }), gate(202, { limit: 4 }), gate(203, { limit: 4 })];
    let held = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 15 }, async (_, i) => {
        const lease = await gates[i % 3]!.acquire(1 + (i % 2));
        if (!lease.ok) throw new Error(lease.error.code);
        held += lease.value.weight;
        peak = Math.max(peak, held);
        await tick(10);
        held -= lease.value.weight;
        await lease.value.release();
      }),
    );
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1);
    expect(await gates[0]!.inUse()).toBe(0);
  });

  it('gives the slot back on release, and a second release is harmless', async () => {
    const one = gate(211, { limit: 1 });
    const first = await one.acquire(1);
    expect(first.ok && (await one.inUse())).toBe(1);
    if (!first.ok) return;
    await first.value.release();
    await first.value.release();
    expect(await one.inUse()).toBe(0);
    const second = await gate(212, { limit: 1 }).acquire(1);
    expect(second.ok).toBe(true);
  });

  it('serves an older two-session waiter before newer one-session requests', async () => {
    const a = gate(221);
    const b = gate(222);
    const c = gate(223);
    const order: string[] = [];
    const held = await a.acquire(1);
    if (!held.ok) throw new Error('no lease');
    const big = b.acquire(2).then((lease) => (order.push('b'), lease));
    await tick();
    const small = c.acquire(1).then((lease) => (order.push('c'), lease));
    await tick();
    // One slot is free, but b asked first and needs two: c must not take it.
    expect(order).toEqual([]);
    await held.value.release();
    const bLease = await big;
    expect(order).toEqual(['b']);
    if (bLease.ok) await bLease.value.release();
    const cLease = await small;
    expect(order).toEqual(['b', 'c']);
    if (cLease.ok) await cLease.value.release();
  });

  it('caps a request above the limit at the limit', async () => {
    const lease = await gate(231).acquire(5);
    expect(lease.ok && lease.value.weight).toBe(2);
    if (lease.ok) await lease.value.release();
  });

  it('sweeps the slots of a process that died', async () => {
    const dead = 999_001;
    await writeFile(join(dir, 'slot-0'), JSON.stringify({ pid: dead, token: 'aa', weight: 1 }));
    await writeFile(join(dir, 'slot-1'), JSON.stringify({ pid: dead, token: 'aa', weight: 1 }));
    const lines: string[] = [];
    const g = gate(241, { isAlive: (pid) => pid !== dead, log: (line) => lines.push(line) });
    const lease = await g.acquire(2);
    expect(lease.ok).toBe(true);
    expect(lines.some((line) => line.includes(`pid ${dead}`))).toBe(true);
    if (lease.ok) await lease.value.release();
  });

  it('sweeps a slot whose heartbeat stopped even when its pid is alive again (pid reuse)', async () => {
    await writeFile(join(dir, 'slot-0'), JSON.stringify({ pid: 251, token: 'bb', weight: 1 }));
    const old = new Date(Date.now() - 10 * 60_000);
    await utimes(join(dir, 'slot-0'), old, old);
    const lease = await gate(252, { limit: 1, staleMs: 60_000 }).acquire(1);
    expect(lease.ok).toBe(true);
    if (lease.ok) await lease.value.release();
  });

  it('keeps a live holder fresh with its heartbeat', async () => {
    const holder = gate(261, { limit: 1, heartbeatMs: 10 });
    const lease = await holder.acquire(1);
    if (!lease.ok) throw new Error('no lease');
    const old = new Date(Date.now() - 10 * 60_000);
    await utimes(join(dir, 'slot-0'), old, old);
    await tick(40);
    const ac = new AbortController();
    const other = gate(262, { limit: 1, staleMs: 1_000 }).acquire(1, ac.signal);
    await tick(40);
    ac.abort();
    expect((await other).ok).toBe(false);
    await lease.value.release();
  });

  it('returns media.cancelled when aborted while waiting, and leaves no waiter behind', async () => {
    const holder = await gate(271, { limit: 1 }).acquire(1);
    const ac = new AbortController();
    const waiting = gate(272, { limit: 1 }).acquire(1, ac.signal);
    await tick();
    ac.abort();
    const result = await waiting;
    expect(!result.ok && result.error.code).toBe('media.cancelled');
    expect((await readdir(dir)).filter((name) => name.startsWith('wait-'))).toEqual([]);
    if (holder.ok) await holder.value.release();
  });

  it('caps this process in memory when the folder cannot be made', async () => {
    const blocker = join(dir, 'file');
    await writeFile(blocker, '');
    const lines: string[] = [];
    const g = createHardwareSessionGate({ dir: join(blocker, 'slots'), limit: 1, log: (l) => lines.push(l) });
    const first = await g.acquire(1);
    expect(first.ok).toBe(true);
    let second = false;
    const next = g.acquire(1).then((lease) => ((second = true), lease));
    await tick();
    expect(second).toBe(false);
    if (first.ok) await first.value.release();
    expect((await next).ok).toBe(true);
    expect(lines[0]).toMatch(/capping this process only/);
  });

  it('waits for a slot a real child process holds, and takes it once that process dies', async () => {
    // The child writes its record the way a gate would (folder.ts) and then just stays alive.
    const script = `require('fs').writeFileSync(${JSON.stringify(join(dir, 'slot-0'))},
      JSON.stringify({ pid: process.pid, token: 'child', weight: 1 })); setInterval(() => {}, 1000);`;
    const child = spawn(process.execPath, ['-e', script], { stdio: 'ignore' });
    try {
      while (!(await readdir(dir)).includes('slot-0')) await tick(10);
      const g = createHardwareSessionGate({ dir, limit: 1, pollMs: 10, log: () => undefined });
      let got = false;
      const waiting = g.acquire(1).then((lease) => ((got = true), lease));
      await tick(100);
      expect(got).toBe(false);
      child.kill('SIGKILL');
      const lease = await waiting;
      expect(lease.ok).toBe(true);
      if (lease.ok) await lease.value.release();
    } finally {
      child.kill('SIGKILL');
    }
  });
});
