// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX-F7: a watched process group does not outlive the process that started it, even when that process is killed
 * with SIGKILL (macOS has no parent-death signal); a released watchdog signals nothing. Real processes
 * (/bin/sh, /bin/sleep), no media.
 */
import type { ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { standInParent } from '../src/test-support';

const PARENT = join(import.meta.dirname, 'support', 'group-parent.ts');

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const started: { parent: ChildProcess; pids: number[] }[] = [];

afterEach(() => {
  for (const { parent, pids } of started.splice(0)) {
    parent.kill('SIGKILL');
    for (const pid of pids) if (alive(pid)) process.kill(pid, 'SIGKILL');
  }
});

/** The stand-in parent, and the pids it printed once its child was up. */
async function parentWith(...args: string[]) {
  const { child: parent, first } = standInParent<{ leader: number; grandchild: number; watchdog: number }>(
    PARENT,
    join(import.meta.dirname, '..'),
    args,
  );
  const entry = { parent, pids: [] as number[] };
  started.push(entry);
  const pids = await first;
  entry.pids.push(pids.leader, pids.grandchild);
  return { parent, ...pids };
}

describe.skipIf(process.platform === 'win32')('watchProcessGroup', () => {
  it('stops the group, grandchildren too, when its parent dies by SIGKILL', async () => {
    const { parent, leader, grandchild, watchdog } = await parentWith();
    expect([alive(leader), alive(grandchild), alive(watchdog)]).toEqual([true, true, true]);
    parent.kill('SIGKILL');
    await expect
      .poll(() => !alive(leader) && !alive(grandchild), { timeout: 10_000, interval: 20 })
      .toBe(true);
    await expect.poll(() => !alive(watchdog), { timeout: 10_000, interval: 20 }).toBe(true);
  }, 20_000);

  it('signals nothing once released: the group outlives its parent', async () => {
    const { parent, leader, grandchild, watchdog } = await parentWith('release');
    await expect.poll(() => !alive(watchdog), { timeout: 5_000, interval: 20 }).toBe(true);
    parent.kill('SIGKILL');
    await expect
      .poll(() => parent.exitCode !== null || parent.signalCode !== null, { timeout: 5_000, interval: 20 })
      .toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect([alive(leader), alive(grandchild)]).toEqual([true, true]);
  }, 20_000);
});
