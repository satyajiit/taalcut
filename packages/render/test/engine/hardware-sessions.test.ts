// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The producer holds its hardware sessions (VideoToolbox encode, Chrome's
 * hardware decode) through media's app-wide gate, because its FFmpeg runs
 * outside ctx.runner. No producer, FFmpeg or Chrome runs here.
 */
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ok } from '@taalcut/core';
import { createHardwareSessionGate } from '@taalcut/media';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  producerSessionWeight,
  withProducerSessions,
  type ProducerChildren,
} from '../../src/engine/hardware-sessions';
import { loadProducerEngine } from '../../src/engine/producer';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'taalcut-render-hw-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('producer hardware sessions', () => {
  it('counts the VideoToolbox encode and Chrome hardware decode', () => {
    expect(producerSessionWeight({ gpuEncode: true, browserGpu: 'hardware' })).toBe(2);
    expect(producerSessionWeight({ gpuEncode: false, browserGpu: 'hardware' })).toBe(1);
    expect(producerSessionWeight({ gpuEncode: false, browserGpu: 'software' })).toBe(0);
  });

  it('holds the sessions while the producer runs and gives them back after', async () => {
    const gate = createHardwareSessionGate({ dir, limit: 4, pollMs: 5 });
    let during = -1;
    const result = await withProducerSessions(
      { hardwareSessions: gate },
      { gpuEncode: true, browserGpu: 'hardware' },
      undefined,
      async () => {
        during = await gate.inUse();
        return ok('video.mp4');
      },
    );
    expect(result.ok).toBe(true);
    expect(during).toBe(2);
    expect(await gate.inUse()).toBe(0);
  });

  it('keeps the sessions after the producer returns until its GPU probe has exited (IX3-F5, H3)', async () => {
    const gate = createHardwareSessionGate({ dir, limit: 4, pollMs: 5 });
    let probeExit: () => void = () => undefined;
    const exited = new Promise<void>((resolve) => (probeExit = resolve));
    const result = await withProducerSessions(
      { hardwareSessions: gate },
      { gpuEncode: true, browserGpu: 'hardware' },
      undefined,
      () => Promise.resolve(ok('video.mp4')),
      () => Promise.resolve({ watch: () => () => undefined, probesLeft: () => ({ exited }) }),
    );
    expect(result.ok).toBe(true);
    expect(await gate.inUse()).toBe(2);
    probeExit();
    await vi.waitFor(async () => expect(await gate.inUse()).toBe(0), { timeout: 2000, interval: 10 });
  });

  it('names every process the engine starts in the slots at its spawn, until its exit (IX3-F7, IX3-F8)', async () => {
    // `ps` never answers here: the pid alone is on disk, as after a quit right after the spawn.
    const gate = createHardwareSessionGate({
      dir,
      limit: 4,
      pollMs: 5,
      startOf: () => new Promise(() => undefined),
    });
    let tell: (pid: number, event: 'spawn' | 'exit') => void = () => undefined;
    let unsubscribed = false;
    const children: ProducerChildren = {
      watch: (listener) => {
        tell = listener;
        return () => void (unsubscribed = true);
      },
      probesLeft: () => null,
    };
    const slots = () =>
      ['slot-0', 'slot-1'].map(
        (name) => (JSON.parse(readFileSync(join(dir, name), 'utf8')) as { children?: unknown }).children,
      );
    const seen: unknown[] = [];
    const result = await withProducerSessions(
      { hardwareSessions: gate },
      { gpuEncode: true, browserGpu: 'hardware' },
      undefined,
      () => {
        tell(5151, 'spawn');
        seen.push(slots());
        tell(6161, 'spawn');
        tell(5151, 'exit');
        seen.push(slots());
        return Promise.resolve(ok('video.mp4'));
      },
      () => Promise.resolve(children),
    );
    expect(result.ok).toBe(true);
    expect(seen).toEqual([
      [[{ pid: 5151 }], [{ pid: 5151 }]],
      [[{ pid: 6161 }], [{ pid: 6161 }]],
    ]);
    // The export returned with 6161 still running (a Chrome past its close timeout): its pid keeps the slots, watched
    // until its own exit (IX3-F8). A process started after the export isn't its own and isn't recorded.
    tell(7171, 'spawn');
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(await gate.inUse()).toBe(2);
    expect(slots()).toEqual([[{ pid: 6161 }], [{ pid: 6161 }]]);
    expect(unsubscribed).toBe(false);
    tell(6161, 'exit');
    await vi.waitFor(async () => expect(await gate.inUse()).toBe(0), { timeout: 2000, interval: 10 });
    expect(unsubscribed).toBe(true);
  });

  it('gives the sessions back at once when every process it followed has exited (IX3-F8)', async () => {
    const gate = createHardwareSessionGate({ dir, limit: 4, pollMs: 5 });
    let tell: (pid: number, event: 'spawn' | 'exit') => void = () => undefined;
    let unsubscribed = false;
    const result = await withProducerSessions(
      { hardwareSessions: gate },
      { gpuEncode: true, browserGpu: 'hardware' },
      undefined,
      () => {
        tell(5151, 'spawn');
        tell(5151, 'exit');
        return Promise.resolve(ok('video.mp4'));
      },
      () =>
        Promise.resolve({
          watch: (listener) => {
            tell = listener;
            return () => void (unsubscribed = true);
          },
          probesLeft: () => null,
        }),
    );
    expect(result.ok).toBe(true);
    expect(await gate.inUse()).toBe(0);
    expect(unsubscribed).toBe(true);
  });

  it('ignores processes already running before work starts (such as an open QA text probe)', async () => {
    const gate = createHardwareSessionGate({ dir, limit: 4, pollMs: 5 });
    let unsubscribed = false;
    const result = await withProducerSessions(
      { hardwareSessions: gate },
      { gpuEncode: true, browserGpu: 'hardware' },
      undefined,
      () => Promise.resolve(ok('video.mp4')),
      () =>
        Promise.resolve({
          watch: (listener) => {
            // Replayed synchronously at subscribe time, before work() starts.
            listener(4040, 'spawn');
            return () => void (unsubscribed = true);
          },
          probesLeft: () => null,
        }),
    );
    expect(result.ok).toBe(true);
    expect(await gate.inUse()).toBe(0);
    expect(unsubscribed).toBe(true);
  });

  it('waits for both a GPU probe and a followed process before it gives the sessions back (IX3-F8)', async () => {
    const gate = createHardwareSessionGate({ dir, limit: 4, pollMs: 5 });
    let tell: (pid: number, event: 'spawn' | 'exit') => void = () => undefined;
    let probeExit: () => void = () => undefined;
    const exited = new Promise<void>((resolve) => (probeExit = resolve));
    await withProducerSessions(
      { hardwareSessions: gate },
      { gpuEncode: true, browserGpu: 'hardware' },
      undefined,
      () => {
        tell(6161, 'spawn');
        return Promise.resolve(ok('video.mp4'));
      },
      () =>
        Promise.resolve({
          watch: (listener) => {
            tell = listener;
            return () => undefined;
          },
          probesLeft: () => ({ exited }),
        }),
    );
    probeExit();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(await gate.inUse()).toBe(2);
    tell(6161, 'exit');
    await vi.waitFor(async () => expect(await gate.inUse()).toBe(0), { timeout: 2000, interval: 10 });
  });

  it("reads the producer's own engine: its probes (none here) and its processes", async () => {
    const engine = await loadProducerEngine();
    expect(engine.gpuProbesExited()).toBeNull();
    const stop = engine.onChildProcess(() => undefined);
    expect(typeof stop).toBe('function');
    stop();
  });

  it('waits while other processes hold the sessions, and a cancel while waiting is core.cancelled', async () => {
    const other = createHardwareSessionGate({ dir, limit: 2, pid: 424_242, isAlive: () => true, pollMs: 5 });
    const held = await other.acquire(2);
    if (!held.ok) throw new Error('no lease');
    const gate = createHardwareSessionGate({ dir, limit: 2, isAlive: () => true, pollMs: 5 });
    const ac = new AbortController();
    let ran = false;
    const waiting = withProducerSessions(
      { hardwareSessions: gate },
      { gpuEncode: true, browserGpu: 'software' },
      ac.signal,
      () => {
        ran = true;
        return Promise.resolve(ok(1));
      },
    );
    await new Promise((r) => setTimeout(r, 40));
    expect(ran).toBe(false);
    ac.abort();
    const result = await waiting;
    expect(!result.ok && result.error.code).toBe('core.cancelled');
    await held.value.release();
  });
});
