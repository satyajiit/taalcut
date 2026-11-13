// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX-F7: a whisper-server does not outlive the jobs process that started it. The pool's idle stop lives in that
 * process, so a kill -9 (the indexing-durability e2e) or a crash used to leave the server, holding its model, until
 * logout. posixServerSpawn gives each server a watchdog (media's watchProcessGroup); a sleep stands in for the server.
 */
import type { ChildProcess } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { standInParent } from '@taalcut/media/test-support';
import { afterEach, describe, expect, it } from 'vitest';
import { posixServerSpawn } from '../../src/whisper/server-spawn';

const PARENT = join(import.meta.dirname, '..', 'support', 'server-parent.ts');

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const leftovers: { parent?: ChildProcess; pid?: number }[] = [];

afterEach(() => {
  for (const { parent, pid } of leftovers.splice(0)) {
    parent?.kill('SIGKILL');
    if (pid !== undefined && alive(pid)) process.kill(pid, 'SIGKILL');
  }
});

/** The stand-in jobs process and the pid of the server it started. */
async function startParent(...args: string[]): Promise<{ parent: ChildProcess; server: number }> {
  const { child: parent, first } = standInParent<{ server: number }>(
    PARENT,
    join(import.meta.dirname, '..', '..'),
    args,
  );
  const entry: { parent: ChildProcess; pid?: number } = { parent };
  leftovers.push(entry);
  const { server } = await first;
  entry.pid = server;
  return { parent, server };
}

describe.skipIf(process.platform === 'win32')('posixServerSpawn', () => {
  it('stops the server when the process that started it is killed with SIGKILL', async () => {
    const { parent, server } = await startParent();
    expect(alive(server)).toBe(true);
    parent.kill('SIGKILL');
    await expect.poll(() => !alive(server), { timeout: 10_000, interval: 20 }).toBe(true);
  }, 20_000);

  it('stops the server when that process exits without stopping it (a quit cut short)', async () => {
    const { server } = await startParent('exit');
    await expect.poll(() => !alive(server), { timeout: 10_000, interval: 20 }).toBe(true);
  }, 20_000);

  it('a server that exits on its own settles, and a later stop signals nothing', async () => {
    const server = posixServerSpawn({
      command: '/bin/sleep',
      args: ['0.1'],
      cwd: tmpdir(),
      onLine: () => undefined,
    });
    leftovers.push({ pid: server.pid });
    expect(await server.exited).toEqual({ code: 0, signal: null });
    // The kill of an exited server is a no-op, never a signal to a reused id.
    server.kill('SIGTERM');
  });
});
