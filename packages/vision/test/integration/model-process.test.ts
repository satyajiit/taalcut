// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX2-S2 with the live model in a process of its own (a Node child, as the evals run it; the lifecycle with fakes:
 * test/cuts/remote-model.test.ts). Its predictions are the model's on this thread, on the same provider; while
 * it runs windows this thread stays free (on this thread a window holds it for the whole native run, which is
 * what stalled the analysis pass reading FFmpeg); and `vision.shots` through it finds a reel's cuts and dissolve
 * as on this thread. Runs when the transnetv2 component folder is present, under the VideoToolbox lock (GPU).
 */
import { fork, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ok, unwrap, type ComputeFallbackEvent } from '@taalcut/core';
import { afterAll, describe, expect, it } from 'vitest';
import { shotModelDevices } from '../../src/cuts/backends';
import { childChannel } from '../../src/cuts/model-channels';
import { remoteShotModel } from '../../src/cuts/remote-model';
import { TRANSNET_FILE, transNetLoader, type ShotBoundaryModel } from '../../src/cuts/transnet';
import { WINDOW_FRAMES } from '../../src/cuts/windows';
import { createOrtRuntime } from '../../src/onnx/ort';
import { detectShots } from '../../src/shots/detect-shots';
import { componentDir } from '../helpers/offline';
import { makeReel, testMedia } from '../helpers/reel';

const modelDir = componentDir('transnetv2', TRANSNET_FILE);
const { ctx } = await testMedia('transnet model process');
const CHILD = fileURLToPath(new URL('../helpers/model-child.ts', import.meta.url));
const FRAME = 48 * 27 * 3;

/** Shots of flat colour with noise, a hard cut every `every` frames: something for both heads to see. */
function window(seed: number, every = 37): Float32Array {
  let state = seed;
  const random = () => ((state = (state * 1103515245 + 12345) % 2 ** 31) / 2 ** 31) * 255;
  const out = new Float32Array(WINDOW_FRAMES * FRAME);
  for (let i = 0; i < WINDOW_FRAMES; i++) {
    const shot = Math.floor((i + seed) / every);
    const colour = [(shot * 97) % 255, (shot * 57) % 255, (shot * 151) % 255];
    for (let k = 0; k < FRAME; k++) out[i * FRAME + k] = 0.8 * (colour[k % 3] ?? 0) + 0.2 * random();
  }
  return out;
}

/** The longest this thread went without a turn while `work` ran. */
async function longestStall(work: () => Promise<unknown>): Promise<number> {
  let last = performance.now();
  let longest = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    longest = Math.max(longest, now - last);
    last = now;
  }, 2);
  await work();
  clearInterval(timer);
  return longest;
}

describe.skipIf(!modelDir)('TransNetV2 in a process of its own', () => {
  const fallbacks: ComputeFallbackEvent[] = [];
  const children: ChildProcess[] = [];
  const onFallback = (event: ComputeFallbackEvent) => fallbacks.push(event);
  const devices = shotModelDevices(process.platform);
  const here = transNetLoader(createOrtRuntime({ onFallback, devices }), async () => modelDir!);
  const remote = remoteShotModel({
    start: async () => {
      const child = fork(CHILD, [], {
        execArgv: ['--import', 'tsx'],
        serialization: 'advanced',
        env: { ...process.env, MODEL_CHILD: 'transnet' },
      });
      children.push(child);
      return ok(childChannel(child));
    },
    modelDir: async () => modelDir!,
    idleMs: 60_000,
    startMs: 60_000,
    expectedBackend: devices[0] ?? 'cpu',
    onFallback,
  });
  let dir = '';
  afterAll(async () => {
    await remote.close();
    if (dir) await rm(dir, { recursive: true, force: true });
    // Released children exit on their own; wait for them.
    await Promise.all(
      children.map((child) =>
        child.exitCode === null ? new Promise((done) => child.once('exit', done)) : undefined,
      ),
    );
  });

  async function both(): Promise<[ShotBoundaryModel, ShotBoundaryModel]> {
    const [a, b] = await Promise.all([here(), remote.load()]);
    if (!a.ok || !b.ok) throw new Error(`${a.ok ? '' : a.error.code} ${b.ok ? '' : b.error.code}`);
    return [a.value, b.value];
  }

  it('gives the model’s predictions, on the same provider', async () => {
    const [onThis, onOwn] = await both();
    for (const seed of [1, 2, 3]) {
      const a = await onThis.predict(window(seed));
      const b = await onOwn.predict(window(seed));
      if (!a.ok || !b.ok)
        throw new Error(`predict failed: ${a.ok ? '' : a.error.code} ${b.ok ? '' : b.error.code}`);
      for (const head of ['single', 'manyHot'] as const)
        for (let i = 0; i < WINDOW_FRAMES; i++)
          expect(b.value[head][i]).toBeCloseTo(a.value[head][i] ?? -1, 4);
    }
    expect(onOwn.backend).toBe(onThis.backend);
    expect(children).toHaveLength(1);
  }, 120_000);

  it('leaves this thread free while it runs windows', async () => {
    const [onThis, onOwn] = await both();
    const run = (model: ShotBoundaryModel) => async () => {
      for (let seed = 0; seed < 6; seed++) await model.predict(window(seed));
    };
    const stalledHere = await longestStall(run(onThis));
    const stalledOwn = await longestStall(run(onOwn));
    console.warn(
      `[vision] longest turn: ${stalledHere.toFixed(1)} ms here, ${stalledOwn.toFixed(1)} ms with its own process`,
    );
    expect(stalledHere).toBeGreaterThan(40);
    expect(stalledOwn).toBeLessThan(stalledHere / 2);
  }, 120_000);

  it.skipIf(!ctx)(
    'finds a reel’s cuts and dissolve as on this thread',
    async () => {
      dir = await mkdtemp(join(tmpdir(), 'taalcut-model-process-'));
      const n = 75;
      const path = join(dir, 'reel.mp4');
      const segments = ['testsrc2', 'smptebars', 'mandelbrot', 'cellauto'].map((source) => ({
        source,
        frames: n,
      }));
      await makeReel(ctx!, path, segments, { width: 320, height: 180, rate: '30', dissolves: { 2: 15 } });
      const inThread = unwrap(await detectShots(path, { media: ctx!, boundaryModel: here, onFallback }));
      const ownProcess = unwrap(
        await detectShots(path, { media: ctx!, boundaryModel: (signal) => remote.load(signal), onFallback }),
      );
      expect(fallbacks).toEqual([]);
      expect(ownProcess.cuts).toEqual(inThread.cuts);
      expect(ownProcess.cuts.map((cut) => cut.kind)).toEqual(['cut', 'dissolve', 'cut']);
    },
    120_000,
  );
});
