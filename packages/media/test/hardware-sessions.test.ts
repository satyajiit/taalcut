// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The app-wide hardware session cap: which FFmpeg commands hold sessions,
 * and the gated runner every media context uses. No FFmpeg runs here; the
 * runner is a fake that records how many commands run at once.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ok } from '@taalcut/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createHardwareSessionGate,
  createMediaService,
  gateHardwareSessions,
  hardwareSessionsFor,
  hardwareSessionWeight,
  TONEMAP_TRIAL_ARGS,
  type BinaryResolver,
  type HardwareSessionGate,
  type ProcessOutput,
  type ProcessRunner,
} from '@taalcut/media';

const VT_DECODE = ['-noautorotate', '-hwaccel', 'videotoolbox', '-hwaccel_output_format', 'videotoolbox_vld'];
const TRANSCODE = [
  ...VT_DECODE,
  '-i',
  'in.mov',
  '-vf',
  'scale_vt=1080:1920',
  '-c:v',
  'h264_videotoolbox',
  'o.mp4',
];

describe('hardwareSessionWeight', () => {
  it('counts a hardware decode and a hardware encode as one session each', () => {
    expect(hardwareSessionWeight(TRANSCODE)).toBe(2);
    expect(hardwareSessionWeight([...VT_DECODE, '-i', 'in.mov', '-frames:v', '1', 'f.png'])).toBe(1);
    expect(
      hardwareSessionWeight(['-i', 'in.mov', '-c:v', 'hevc_videotoolbox', '-tag:v', 'hvc1', 'o.mp4']),
    ).toBe(1);
    expect(
      hardwareSessionWeight([
        '-i',
        'a.mov',
        '-i',
        'b.mov',
        '-map',
        '0:v',
        '-c:v:0',
        'h264_videotoolbox',
        'o',
      ]),
    ).toBe(1);
  });

  it('counts GPU filter work (libplacebo on Vulkan, a bare hardware device)', () => {
    expect(hardwareSessionWeight(TONEMAP_TRIAL_ARGS)).toBe(1);
    expect(
      hardwareSessionWeight(['-init_hw_device', 'videotoolbox', '-i', 'x', '-vf', 'hwupload', 'o']),
    ).toBe(1);
  });

  it('holds nothing for CPU work, listings and probes', () => {
    expect(hardwareSessionWeight(['-encoders'])).toBe(0);
    expect(hardwareSessionWeight(['-i', 'in.mov', '-c:v', 'libopenh264', 'o.mp4'])).toBe(0);
    expect(hardwareSessionWeight(['-hwaccel', 'none', '-i', 'in.mov', '-f', 'null', '-'])).toBe(0);
    expect(hardwareSessionWeight(['-v', 'error', '-show_streams', '-of', 'json', 'in.mov'])).toBe(0);
    // The encoder name as a file or metadata value is not an encode.
    expect(
      hardwareSessionWeight(['-i', 'h264_videotoolbox', '-metadata', 'title=h264_videotoolbox', 'o']),
    ).toBe(0);
  });

  it('keeps explicitly software VideoToolbox outside the GPU cap without hiding other sessions', () => {
    const software = ['-c:v', 'h264_videotoolbox', '-require_sw', '1', 'o.mp4'];
    expect(hardwareSessionWeight(['-i', 'in.mov', ...software])).toBe(0);
    expect(hardwareSessionWeight([...VT_DECODE, '-i', 'in.mov', ...software])).toBe(1);
    expect(hardwareSessionWeight(['-i', 'in.mov', ...software, '-require_sw', '0'])).toBe(1);
    expect(hardwareSessionWeight(['-i', 'in.mov', ...software, '-c:v', 'h264_nvenc', 'b.mp4'])).toBe(2);
  });
});

/**
 * A runner whose commands wait at a barrier until the test lets one go, recording the peak of commands inside
 * at once. `inside(n)` resolves when n are waiting there: no clock decides whether two overlapped.
 */
function barrierRunner() {
  const waiting: (() => void)[] = [];
  const seen = { peak: 0, calls: 0 };
  let arrived: (() => void) | undefined;
  const runner: ProcessRunner = async () => {
    seen.calls++;
    await new Promise<void>((release) => {
      waiting.push(release);
      seen.peak = Math.max(seen.peak, waiting.length);
      arrived?.();
    });
    const output: ProcessOutput = {
      exitCode: 0,
      signal: null,
      stdout: Buffer.alloc(0),
      stderrTail: '',
      durationMs: 0,
    };
    return ok(output);
  };
  const inside = (n: number) =>
    new Promise<void>((resolve) => {
      arrived = () => {
        if (waiting.length < n) return;
        arrived = undefined;
        resolve();
      };
      arrived();
    });
  const releaseOne = () => waiting.shift()?.();
  return { runner, seen, inside, releaseOne, count: () => waiting.length };
}

/** A runner that takes `ms` per command and records the peak of commands running at once. */
function countingRunner(ms = 15) {
  let running = 0;
  const seen = { peak: 0, calls: 0 };
  const runner: ProcessRunner = async () => {
    running++;
    seen.calls++;
    seen.peak = Math.max(seen.peak, running);
    await new Promise((r) => setTimeout(r, ms));
    running--;
    const output: ProcessOutput = {
      exitCode: 0,
      signal: null,
      stdout: Buffer.alloc(0),
      stderrTail: '',
      durationMs: ms,
    };
    return ok(output);
  };
  return { runner, seen };
}

describe('gateHardwareSessions', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'taalcut-hw-runner-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('runs at most limit/weight hardware transcodes at once, across two processes', async () => {
    const barrier = barrierRunner();
    // Two gates on one folder stand for the jobs and render processes.
    const jobsGate = createHardwareSessionGate({ dir, limit: 4, pid: 101, isAlive: () => true, pollMs: 5 });
    const jobs = gateHardwareSessions(jobsGate, barrier.runner);
    const render = gateHardwareSessions(
      createHardwareSessionGate({ dir, limit: 4, pid: 102, isAlive: () => true, pollMs: 5 }),
      barrier.runner,
    );
    const results = Promise.all(
      Array.from({ length: 10 }, (_, i) => (i % 2 ? jobs : render)('ffmpeg', TRANSCODE)),
    );
    // Each transcode holds two sessions of four. The limit is reached: two are inside, holding all four…
    await barrier.inside(2);
    expect(await jobsGate.inUse()).toBe(4);
    // …and each one let out makes room for exactly one more, until all ten have run.
    while (barrier.seen.calls < 10) {
      expect(barrier.count()).toBe(2);
      barrier.releaseOne();
      await barrier.inside(2);
    }
    barrier.releaseOne();
    barrier.releaseOne();
    expect((await results).every((r) => r.ok)).toBe(true);
    expect(barrier.seen.calls).toBe(10);
    // Never more than two inside at once, across both processes.
    expect(barrier.seen.peak).toBe(2);
    expect(await jobsGate.inUse()).toBe(0);
  });

  it('does not count a waiter that was already let in as still ahead of the next one', async () => {
    // A transcode of the render process holds slots 0 and 1, and its wait record is not yet removed (it is
    // removed right after the slots are taken). The next transcode must get slots 2 and 3 at its first look:
    // a minute between looks leaves no second one within the test's time.
    const admitted = { pid: 201, token: 'a1a1a1a1a1a1a1a1', weight: 2 };
    for (const name of ['slot-0', 'slot-1', `wait-${'1'.padStart(15, '0')}-${admitted.token}`])
      await writeFile(join(dir, name), JSON.stringify(admitted));
    const gate = createHardwareSessionGate({ dir, limit: 4, pid: 102, isAlive: () => true, pollMs: 60_000 });
    const lease = await gate.acquire(2);
    expect(lease.ok).toBe(true);
    expect(await gate.inUse()).toBe(4);
    if (lease.ok) await lease.value.release();
  });

  it('lets CPU-only commands through while every session is held', async () => {
    const gate = createHardwareSessionGate({ dir, limit: 1, pollMs: 5 });
    const held = await gate.acquire(1);
    expect(held.ok).toBe(true);
    const { runner, seen } = countingRunner(1);
    const run = gateHardwareSessions(gate, runner);
    const probe = await run('ffprobe', ['-show_streams', 'in.mov']);
    expect(probe.ok).toBe(true);
    expect(seen.calls).toBe(1);
    if (held.ok) await held.value.release();
  });

  it('holds the sessions of a run started another way (the tools sandbox), and none for CPU work', async () => {
    const gate = createHardwareSessionGate({ dir, limit: 4, pollMs: 5 });
    const hold = hardwareSessionsFor(gate);
    const transcode = await hold('ffmpeg', TRANSCODE);
    expect(transcode.ok && transcode.value.weight).toBe(2);
    expect(await gate.inUse()).toBe(2);
    const cpu = await hold('ffmpeg', ['-f', 'lavfi', '-i', 'color', '-f', 'null', '-']);
    expect(cpu.ok && cpu.value.weight).toBe(0);
    expect(await gate.inUse()).toBe(2);
    if (transcode.ok) await transcode.value.release();
    expect(await gate.inUse()).toBe(0);
  });

  it('does not wrap a gated runner twice (a nested wait could never end)', () => {
    const gate = createHardwareSessionGate({ dir, limit: 1 });
    const once = gateHardwareSessions(gate);
    expect(gateHardwareSessions(gate, once)).toBe(once);
  });

  it('a media service with the gate runs FFmpeg through it', async () => {
    const acquired: number[] = [];
    const gate: HardwareSessionGate = {
      acquire: (weight) => {
        acquired.push(weight);
        return Promise.resolve(ok({ weight, release: () => Promise.resolve() }));
      },
      limit: () => Promise.resolve(4),
      inUse: () => Promise.resolve(0),
    };
    const resolver: BinaryResolver = {
      resolve: () =>
        Promise.resolve(
          ok({ ffmpeg: '/bin/ffmpeg', ffprobe: '/bin/ffprobe', source: 'sidecar' as const, licence: 'lgpl' }),
        ),
    } as unknown as BinaryResolver;
    const { runner } = countingRunner(1);
    const service = createMediaService({ resolver, runner, hardwareSessions: gate });
    const result = await service.runFfmpeg(TRANSCODE);
    expect(result.ok).toBe(true);
    expect(acquired).toEqual([2]);
  });
});
