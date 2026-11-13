// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The workspace shell's limits on macOS (AGT2 sbx): the memory watchdog (macOS has no memory rlimit), the wall
 * clock, the folder's size, a cancel, and the end of everything a command left running, including a child that
 * left the process group after a poll saw it. Every process these tests start is ended by the shell; afterEach
 * ends any the shell missed (by the pids the commands printed: only ours) and fails the test.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { confined, nodeToolchain, running, shellFolder, shellSkipReason } from '../helpers/shell';
import { skipMessage } from '../helpers/sandbox';

const skip = shellSkipReason();
skipMessage('workspace shell limits', skip);

let folder: string;
let cleanup: () => void;
const started: number[] = [];
beforeEach(async () => {
  ({ folder, cleanup } = await shellFolder());
});
afterEach(() => {
  const left = started.splice(0).filter(running);
  for (const pid of left) process.kill(pid, 'SIGKILL');
  cleanup();
  expect(left).toEqual([]);
});

/** The pids a command printed as `pid=<n>`. */
const pidsIn = (text: string) => [...text.matchAll(/pid=(\d+)/g)].map((match) => Number(match[1]));

describe.skipIf(skip !== '')('the workspace shell', { timeout: 120_000 }, () => {
  it('stops a tree over its memory and says so', async () => {
    const result = await confined(
      folder,
      `node -e "const a=[]; setInterval(()=>a.push(Buffer.alloc(64*1024*1024,1)),20)"`,
      { toolchain: nodeToolchain(), limits: { memoryBytes: 400 * 1024 ** 2 } },
    );
    expect(result.ok && result.value.stopped).toBe('memory');
    expect(result.ok && result.value.peakMemoryBytes).toBeGreaterThan(400 * 1024 ** 2);
  });

  it('stops at the wall clock with the output so far', async () => {
    const result = await confined(folder, 'echo before; echo "pid=$$"; sleep 30; echo after', {
      limits: { wallMs: 1500 },
    });
    if (result.ok) started.push(...pidsIn(result.value.stdout));
    expect(result.ok && result.value.stopped).toBe('time');
    expect(result.ok && result.value.stdout).toMatch(/^before/);
    expect(result.ok && result.value.stdout).not.toMatch(/after/);
    expect(result.ok && result.value.durationMs).toBeLessThan(10_000);
  });

  it('ends what a command left running, in its group or out of it', async () => {
    // A background job stays in the group; the second child leaves it (setsid) once a poll has seen it.
    const result = await confined(
      folder,
      [
        'sleep 300 & echo "pid=$!"',
        `perl -MPOSIX -e 'sleep 1; POSIX::setsid(); print "pid=$$\\n"; close STDOUT; close STDERR; sleep 300' &`,
        'sleep 2; echo done',
      ].join('\n'),
    );
    expect(result.ok && result.value.exitCode).toBe(0);
    const pids = result.ok ? pidsIn(result.value.stdout) : [];
    started.push(...pids);
    expect(pids).toHaveLength(2);
    // SIGKILL lands at once, but the kernel reaps a moment later.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(pids.filter(running)).toEqual([]);
  });

  it('stops a folder over its size', async () => {
    const result = await confined(
      folder,
      'dd if=/dev/zero of=../out/big.bin bs=1m count=64 2>/dev/null; sleep 5',
      {
        limits: { diskBytes: 16 * 1024 ** 2 },
      },
    );
    expect(result.ok && result.value.stopped).toBe('disk');
  });

  it('caps one file with ulimit -f', async () => {
    const result = await confined(folder, 'dd if=/dev/zero of=../out/big.bin bs=1m count=8 2>/dev/null', {
      limits: { maxFileBytes: 1024 ** 2 },
    });
    expect(result.ok && result.value.stopped).toBe('fileSize');
  });

  it('is cancelled by its signal, and the tree goes with it', async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 800);
    const pids: number[] = [];
    const result = await confined(folder, 'sleep 300', {
      run: { signal: controller.signal, onSpawn: (pid) => pids.push(pid) },
    });
    started.push(...pids);
    expect(result.ok ? 'ok' : result.error.code).toBe('core.cancelled');
    await new Promise((resolve) => setTimeout(resolve, 2500));
    expect(pids.filter(running)).toEqual([]);
  });

  it('keeps the head and tail of a long output and says how much it cut', async () => {
    const result = await confined(folder, 'seq 1 100000', { stdoutBytes: 3000 });
    expect(result.ok && result.value.stdout).toMatch(/^1\n2\n3\n/);
    expect(result.ok && result.value.stdout).toMatch(/\[… \d+ bytes cut …\]/);
    expect(result.ok && result.value.stdout).toMatch(/100000\n$/);
  });

  it('does not launch when cancellation arrives during process admission', async () => {
    const controller = new AbortController();
    const pids: number[] = [];
    const result = await confined(folder, 'sleep 300', {
      run: {
        signal: controller.signal,
        list: async () => {
          controller.abort();
          return [];
        },
        onSpawn: (pid) => {
          pids.push(pid);
          started.push(pid);
        },
      },
    });
    expect(result.ok ? 'ok' : result.error.code).toBe('core.cancelled');
    expect(pids).toEqual([]);
  });

  it('cancels an owned tree when onSpawn aborts before listener registration', async () => {
    const controller = new AbortController();
    const pids: number[] = [];
    const result = await confined(folder, 'sleep 300', {
      run: {
        signal: controller.signal,
        onSpawn: (pid) => {
          pids.push(pid);
          started.push(pid);
          controller.abort();
        },
      },
    });
    expect(result.ok ? 'ok' : result.error.code).toBe('core.cancelled');
    await new Promise((resolve) => setTimeout(resolve, 2500));
    expect(pids).toHaveLength(1);
    expect(pids.filter(running)).toEqual([]);
  });
});
