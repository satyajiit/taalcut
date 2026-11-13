// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Analyse and discard (P2-T3) when the disk says no: a discard that can't
 * remove the folder is an error value the caller must handle, and the sweep
 * removes what it can and leaves the rest for its next run. The jobs process
 * sweeps the scratch root at start and hourly through `sweepExperiments`.
 */
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createManualClock } from '@taalcut/core';
import { createExperimentSandbox, sweepExperiments } from '@taalcut/tools';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { experimentId, tempRoot } from './helpers/sandbox';

let temp: { root: string; cleanup: () => void };
let root: string;
const locked: string[] = [];
beforeEach(() => {
  temp = tempRoot();
  root = join(temp.root, 'scratch');
});
afterEach(() => {
  for (const dir of locked.splice(0)) chmodSync(dir, 0o755);
  temp.cleanup();
});

function setup() {
  const clock = createManualClock(5_000);
  const sandbox = createExperimentSandbox({
    root,
    clock,
    programs: { ffmpeg: '/bin/echo', ffprobe: '/bin/echo' },
  });
  /** An experiment holding a download in a folder nothing may delete from. */
  const stuck = async (ttlMs?: number) => {
    const id = experimentId();
    const opened = await sandbox.open({
      id,
      projectId: null,
      purpose: 'breakdown',
      ...(ttlMs ? { ttlMs } : {}),
    });
    if (!opened.ok) throw new Error('open failed');
    const dir = join(opened.value.dir, 'frames');
    mkdirSync(dir);
    writeFileSync(join(dir, 'reference.mp4'), Buffer.alloc(100));
    chmodSync(dir, 0o555);
    locked.push(dir);
    return { id, dir: opened.value.dir };
  };
  return { sandbox, clock, stuck };
}

describe('discard and sweep when a folder cannot be removed', () => {
  it('discard returns sandbox.discard_failed instead of throwing, and the experiment is still there', async () => {
    const { sandbox, stuck } = setup();
    const { id, dir } = await stuck();
    const discarded = await sandbox.discard(id);
    expect(discarded).toMatchObject({
      ok: false,
      error: { code: 'sandbox.discard_failed', retryable: true },
    });
    expect(existsSync(join(dir, 'frames', 'reference.mp4'))).toBe(true);
    for (const dir of locked.splice(0)) chmodSync(dir, 0o755);
    expect((await sandbox.discard(id)).ok).toBe(true);
    expect(existsSync(dir)).toBe(false);
  });

  it('the sweep removes every expired folder it can and keeps going past one it cannot', async () => {
    const { sandbox, clock, stuck } = setup();
    const blocked = await stuck(10);
    const expired = experimentId();
    await sandbox.open({ id: expired, projectId: null, purpose: 'breakdown', ttlMs: 10 });
    clock.advance(100);
    const swept = await sandbox.sweep();
    expect(swept.ok && swept.value.removed).toEqual([expired]);
    expect(existsSync(join(root, expired))).toBe(false);
    expect(existsSync(blocked.dir)).toBe(true);
    for (const dir of locked.splice(0)) chmodSync(dir, 0o755);
    const again = await sandbox.sweep();
    expect(again.ok && again.value.removed).toEqual([blocked.id]);
  });

  it('sweepExperiments sweeps a scratch root without a sandbox: expired goes, live stays', async () => {
    const { sandbox, clock } = setup();
    const live = experimentId();
    const expired = experimentId();
    await sandbox.open({ id: live, projectId: null, purpose: 'breakdown' });
    await sandbox.open({ id: expired, projectId: null, purpose: 'breakdown', ttlMs: 10 });
    clock.advance(100);
    const swept = await sweepExperiments({ root, clock });
    expect(swept.ok && swept.value.removed).toEqual([expired]);
    expect(existsSync(join(root, live))).toBe(true);
    // A missing root is created, not an error: the first start has no scratch yet.
    const fresh = await sweepExperiments({ root: join(temp.root, 'other', 'scratch'), clock });
    expect(fresh.ok && fresh.value.removed).toEqual([]);
  });
});
