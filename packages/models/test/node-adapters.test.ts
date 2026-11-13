// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * '@taalcut/models/node': the child_process SpawnPort and the free-port
 * finder the desktop wires into the llama-server driver. Real processes, no
 * network beyond 127.0.0.1. The run against the real llama-server is
 * llama-server.live.test.ts.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createNodeSpawnPort, findFreeLoopbackPort, type NodeSpawnPort } from '@taalcut/models/node';

const PARENT = join(import.meta.dirname, 'support', 'spawn-parent.ts');

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const until = async (check: () => boolean, timeoutMs = 15_000) => {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for the condition.');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

let port: NodeSpawnPort;
beforeEach(() => {
  port = createNodeSpawnPort();
});
afterEach(() => port.dispose());

const run = (command: string, args: readonly string[], env: Record<string, string> = {}) => {
  const lines: string[] = [];
  const started = port.spawn({ command, args, env, onOutput: (line) => lines.push(line) });
  return { started, lines };
};

describe.skipIf(process.platform === 'win32')('createNodeSpawnPort', () => {
  it('passes exactly the given environment and forwards stdout and stderr line by line', async () => {
    const env = run('/usr/bin/env', [], { LLAMA_API_KEY: 'per-launch' });
    expect(await env.started.exited).toEqual({ code: 0, signal: null });
    expect(env.lines).toEqual(['LLAMA_API_KEY=per-launch']);
    const stderr = run('/bin/sh', ['-c', 'echo first >&2; printf "second\\r\\nthird" >&2']);
    await stderr.started.exited;
    expect(stderr.lines).toEqual(['first', 'second', 'third']);
  });

  it('reports exit codes, and a binary that is missing as an exit with no code', async () => {
    expect(await run(process.execPath, ['-e', 'process.exit(3)']).started.exited).toEqual({
      code: 3,
      signal: null,
    });
    const missing = run('/nonexistent/llama-server', []);
    expect(await missing.started.exited).toEqual({ code: null, signal: null });
    expect(missing.lines.join('\n')).toContain('ENOENT');
  });

  it('signals the whole process group, so nothing the sidecar started survives it', async () => {
    const { started, lines } = run('/bin/sh', ['-c', '/bin/sleep 60 & echo "$!"; wait']);
    await until(() => lines.length > 0);
    const grandchild = Number(lines[0]);
    expect(alive(grandchild)).toBe(true);
    started.kill('SIGTERM');
    await started.exited;
    await until(() => !alive(grandchild));
  });

  it('dispose() kills whatever is still running', async () => {
    const { started } = run('/bin/sleep', ['60']);
    port.dispose();
    expect(await started.exited).toMatchObject({ signal: 'SIGKILL' });
  });

  it('stops the sidecar and its children when the app process dies without cleaning up', async () => {
    const parent = spawn(process.execPath, ['--import', 'tsx', PARENT], {
      cwd: join(import.meta.dirname, '..'),
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    try {
      const line = await new Promise<string>((resolve, reject) => {
        createInterface({ input: parent.stdout }).once('line', resolve);
        parent.once('exit', (code) => reject(new Error(`spawn-parent exited with ${code}`)));
      });
      const { sidecar, grandchild } = JSON.parse(line) as { sidecar: number; grandchild: number };
      expect([alive(sidecar), alive(grandchild)]).toEqual([true, true]);
      parent.kill('SIGKILL');
      await until(() => !alive(sidecar) && !alive(grandchild), 10_000);
    } finally {
      parent.kill('SIGKILL');
    }
  }, 20_000);
});

describe('findFreeLoopbackPort', () => {
  it('returns a port that can be bound on 127.0.0.1', async () => {
    const found = await findFreeLoopbackPort();
    expect(found).toBeGreaterThan(0);
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(found, '127.0.0.1', resolve);
    });
    await new Promise((resolve) => server.close(resolve));
  });
});
