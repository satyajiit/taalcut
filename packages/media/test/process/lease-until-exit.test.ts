// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX3-K2: the hardware session lease of a run left running past its stop (it may hold a video session, so it is
 * never killed) stays held until the process exits, while the caller already has its `media.cancelled`. A run
 * whose process exits in time, and a runner that never reports an outliving process (the test doubles every
 * package uses), give the lease back when they settle, as before.
 */
import { ok } from '@taalcut/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createEndPolicy,
  createProcessRunner,
  FFMPEG_STOP,
  gateHardwareSessions,
  type HardwareSessionGate,
  type ProcessRunner,
} from '@taalcut/media';

const node = process.execPath;
const strays: number[] = [];
afterEach(() => {
  for (const pid of strays.splice(0)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Already gone.
    }
  }
});

/** A gate that counts leases held now. */
function countingGate(): HardwareSessionGate & { held: () => number } {
  let held = 0;
  return {
    held: () => held,
    limit: () => Promise.resolve(4),
    inUse: () => Promise.resolve(held),
    acquire: (weight) => {
      held += weight;
      let released = false;
      return Promise.resolve(
        ok({
          weight,
          release: () => {
            if (!released) held -= weight;
            released = true;
            return Promise.resolve();
          },
        }),
      );
    },
  };
}

/** Arguments that open one hardware decode (the gate's weight), after a Node script that ignores q and SIGTERM. */
const STUCK = [
  '-e',
  "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000); process.stdout.write('ready ' + process.pid);",
  '--',
  '-hwaccel',
  'videotoolbox',
];
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('the lease of a run left running', () => {
  it('stays held after the caller is released, until the process exits', async () => {
    const gate = countingGate();
    const runner = gateHardwareSessions(gate, createProcessRunner(createEndPolicy({ stallAfterMs: 60_000 })));
    const controller = new AbortController();
    let pid = 0;
    const result = await runner(node, STUCK, {
      killGraceMs: 100,
      signal: controller.signal,
      holdsVideoSession: true,
      program: FFMPEG_STOP,
      onStdout: (chunk) => {
        const ready = /ready (\d+)/.exec(chunk.toString());
        if (!ready) return;
        pid = Number(ready[1]);
        strays.push(pid);
        controller.abort();
      },
    });
    expect(!result.ok && result.error.code).toBe('media.cancelled');
    expect(gate.held()).toBe(1);
    await pause(300);
    expect(gate.held()).toBe(1);
    process.kill(pid, 'SIGKILL');
    await expect.poll(() => gate.held(), { timeout: 3000 }).toBe(0);
  }, 10_000);

  it('is given back at once by a runner that settles after the exit', async () => {
    const gate = countingGate();
    const fake: ProcessRunner = () =>
      Promise.resolve(
        ok({ exitCode: 0, signal: null, stdout: Buffer.alloc(0), stderrTail: '', durationMs: 1 }),
      );
    const result = await gateHardwareSessions(gate, fake)('/x/ffmpeg', ['-hwaccel', 'videotoolbox'], {});
    expect(result.ok).toBe(true);
    expect(gate.held()).toBe(0);
  });

  it('passes the outliving process on to a caller that asked as well', async () => {
    const gate = countingGate();
    let exited: Promise<void> | undefined;
    const fake: ProcessRunner = (_command, _args, options) => {
      options?.onOutlive?.(new Promise<void>(() => undefined));
      return Promise.resolve(
        ok({ exitCode: null, signal: null, stdout: Buffer.alloc(0), stderrTail: '', durationMs: 1 }),
      );
    };
    await gateHardwareSessions(gate, fake)('/x/ffmpeg', ['-hwaccel', 'videotoolbox'], {
      onOutlive: (gone) => (exited = gone),
    });
    expect(exited).toBeDefined();
    expect(gate.held()).toBe(1);
  });
});
