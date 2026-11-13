// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Review findings on the runner: grandchildren that hold the stdout pipe must
 * not keep the runner (or themselves) alive, and sidecars must not inherit the
 * app's environment.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runProcess, type RunOptions } from '@taalcut/media';

const node = process.execPath;
let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'taalcut-runner-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    return (cause as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Waits until `pid` is gone, up to `ms`. Reaping by launchd can lag the kill, more so on a busy machine. */
async function gone(pid: number, ms = 3000): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (!alive(pid)) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  return !alive(pid);
}

/** A child script that starts `sleep 30` with inherited stdio (it holds our stdout pipe) and records its pid. */
const SPAWN_SLEEPER = `
  const { spawn } = require('node:child_process');
  const fs = require('node:fs');
  const sleeper = () => {
    const g = spawn('sleep', ['30'], { stdio: 'inherit' });
    fs.writeFileSync(process.env.PIDFILE, String(g.pid));
  };`;

/**
 * The grandchild sleeps 30 s, so a runner that waited for it would take that
 * long. Bounds below are far under 30 s but loose enough for a machine busy
 * with every package's tests at once (node itself can take a second to start).
 */
const HUNG = 10_000;

async function run(code: string, name: string, options: RunOptions & { abortOnReady?: boolean } = {}) {
  const pidfile = join(dir, `${name}.pid`);
  const controller = new AbortController();
  let abortedAt: number | undefined;
  const started = Date.now();
  const result = await runProcess(node, ['-e', code], {
    killGraceMs: 200,
    env: { PATH: process.env.PATH, PIDFILE: pidfile },
    ...(options.abortOnReady
      ? {
          signal: controller.signal,
          onStdout: (chunk: Buffer) => {
            if (!chunk.toString().includes('ready')) return;
            abortedAt = Date.now();
            controller.abort();
          },
        }
      : {}),
    ...options,
  });
  const ended = Date.now();
  const grandchild = Number(await readFile(pidfile, 'utf8'));
  // From the abort when there is one: what happens after it is the runner's doing.
  return { result, elapsed: ended - (abortedAt ?? started), grandchild };
}

describe('process-group cleanup', () => {
  it('settles when the child exits on SIGTERM but a grandchild holds the pipe, and kills the grandchild', async () => {
    const code = `${SPAWN_SLEEPER}
      process.on('SIGTERM', () => { sleeper(); process.exit(0); });
      setInterval(() => {}, 1000);
      process.stdout.write('ready');`;
    const { result, elapsed, grandchild } = await run(code, 'exits-on-term', { abortOnReady: true });
    expect(!result.ok && result.error.code).toBe('media.cancelled');
    expect(elapsed).toBeLessThan(HUNG);
    expect(await gone(grandchild)).toBe(true);
  }, 25_000);

  it('kills a grandchild along with a child that ignores SIGTERM', async () => {
    const code = `${SPAWN_SLEEPER}
      process.on('SIGTERM', () => {});
      sleeper();
      setInterval(() => {}, 1000);
      process.stdout.write('ready');`;
    const { result, elapsed, grandchild } = await run(code, 'ignores-term', { abortOnReady: true });
    expect(!result.ok && result.error.code).toBe('media.cancelled');
    expect(!result.ok && result.error.detail).toContain('SIGKILL');
    expect(elapsed).toBeLessThan(HUNG);
    expect(await gone(grandchild)).toBe(true);
  }, 25_000);

  it('returns after a normal exit even if a grandchild keeps the pipe open, and kills it', async () => {
    const code = `${SPAWN_SLEEPER} sleeper(); process.stdout.write('done'); process.exit(0);`;
    const { result, elapsed, grandchild } = await run(code, 'leaves-orphan');
    expect(result.ok && result.value.exitCode).toBe(0);
    expect(result.ok && result.value.stdout.toString()).toBe('done');
    expect(elapsed).toBeLessThan(HUNG);
    expect(await gone(grandchild)).toBe(true);
  }, 25_000);
});

describe('pipes held from outside the group', () => {
  it('stops waiting for a process that left the group but holds the pipe', async () => {
    // The grandchild starts its own group, so the group SIGKILL can't reach it; the runner
    // must still return a grace period later instead of waiting for it to close the pipe.
    const code = `
      const { spawn } = require('node:child_process');
      const fs = require('node:fs');
      const g = spawn('sleep', ['30'], { stdio: 'inherit', detached: true });
      fs.writeFileSync(process.env.PIDFILE, String(g.pid));
      process.on('SIGTERM', () => {});
      setInterval(() => {}, 1000);
      process.stdout.write('ready');`;
    const { result, elapsed, grandchild } = await run(code, 'escaped', { abortOnReady: true });
    try {
      expect(!result.ok && result.error.code).toBe('media.cancelled');
      expect(elapsed).toBeLessThan(HUNG);
    } finally {
      process.kill(grandchild, 'SIGKILL');
    }
  }, 25_000);
});

describe('environment', () => {
  it("does not pass the app's environment to a sidecar unless asked", async () => {
    process.env.TAALCUT_TEST_SECRET = 'sekret-value';
    try {
      const dump = ['-e', 'process.stdout.write(JSON.stringify(process.env))'];
      const isolated = await runProcess(node, dump);
      const env = isolated.ok ? (JSON.parse(isolated.value.stdout.toString()) as Record<string, string>) : {};
      expect(env.TAALCUT_TEST_SECRET).toBeUndefined();
      expect(env.PATH).toBe(process.env.PATH);

      const explicit = await runProcess(node, dump, { env: { TAALCUT_TEST_SECRET: 'given' } });
      expect(explicit.ok && JSON.parse(explicit.value.stdout.toString()).TAALCUT_TEST_SECRET).toBe('given');
    } finally {
      delete process.env.TAALCUT_TEST_SECRET;
    }
  });
});
