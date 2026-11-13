// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX2-S2: the model's process as the evals run it, a real Node child over its IPC channel (with the
 * picture-change stand-in, helpers/model-child.ts; the live model: integration/model-process.test.ts). Windows
 * go over as Float32Arrays and come back as the model's output; the child exits when released, when the client
 * lets it go, and when its parent dies (no orphan).
 */
import { fork, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ok } from '@taalcut/core';
import { afterEach, describe, expect, it } from 'vitest';
import { processAlive } from '@taalcut/media';
import { standInParent } from '@taalcut/media/test-support';
import { childChannel } from '../../src/cuts/model-channels';
import { remoteShotModel } from '../../src/cuts/remote-model';
import { pictureChangeModel } from '../../src/test-support';
import { grayWindow } from '../helpers/model-pair';

const CHILD = fileURLToPath(new URL('../helpers/model-child.ts', import.meta.url));
const PARENT = fileURLToPath(new URL('../helpers/model-child-parent.ts', import.meta.url));
const children: ChildProcess[] = [];

afterEach(() => {
  for (const child of children.splice(0)) if (child.exitCode === null) child.disconnect?.();
});

function spawnChild(): ChildProcess {
  const child = fork(CHILD, [], { execArgv: ['--import', 'tsx'], serialization: 'advanced' });
  children.push(child);
  return child;
}

const exited = (child: ChildProcess) =>
  new Promise<number | null>((resolve) => {
    if (child.exitCode !== null) resolve(child.exitCode);
    else child.once('exit', (code) => resolve(code));
  });

describe('the model in a Node child', () => {
  it('runs windows sent over IPC and exits when released', async () => {
    const child = spawnChild();
    const remote = remoteShotModel({
      start: async () => ok(childChannel(child)),
      modelDir: async () => '/unused',
      idleMs: 60_000,
      startMs: 30_000,
      expectedBackend: 'webgpu',
    });
    const loaded = await remote.load();
    if (!loaded.ok) throw new Error(loaded.error.code);
    const windows = [grayWindow([0, 0, 200]), grayWindow([90, 90, 90, 0])];
    const outputs = await Promise.all(windows.map((w) => loaded.value.predict(w)));
    const expected = await Promise.all(windows.map((w) => pictureChangeModel().predict(w)));
    expect(outputs).toEqual(expected);
    expect(loaded.value.backend).toBe('cpu');
    await remote.close();
    expect(await exited(child)).toBe(0);
  }, 30_000);

  it('exits when the client lets it go without a release', async () => {
    const child = spawnChild();
    const channel = childChannel(child);
    channel.close();
    expect(await exited(child)).toBe(3);
  }, 30_000);

  it('exits when its parent dies', async () => {
    const { child: parent, first } = standInParent<{ model: number }>(
      PARENT,
      join(import.meta.dirname, '..', '..'),
    );
    const { model: pid } = await first;
    expect(processAlive(pid)).toBe(true);
    parent.kill('SIGKILL');
    await expect.poll(() => processAlive(pid), { timeout: 10_000, interval: 50 }).toBe(false);
  }, 30_000);
});
