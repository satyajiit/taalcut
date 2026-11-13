// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX2-S11: TransNetV2 on Core ML in the mac helper against the ONNX model it stands in for, live. The same windows
 * through both give the same probabilities to 1e-4 (fp32 on the GPU), and shots on synthetic footage (hard cuts
 * and a dissolve, at 25, 30 and 60 fps) come out the same: every cut's frame, kind and span. The pack's gate
 * (tools/components/transnetv2-coreml/gate.py) compares every ix-v1 window the same way.
 *
 * Opt-in: needs the helper (native/mac-helper/build.sh), `.cache/transnetv2` and `.cache/transnetv2-coreml`
 * (tools/components/pack-transnetv2-coreml.sh); skipped with the reason otherwise.
 */
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unwrap, type AsyncResult } from '@taalcut/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { shotModelDevices } from '../../src/cuts/backends';
import { developmentShotsHelper } from '../../src/cuts/coreml-development';
import { coreMlShotModel } from '../../src/cuts/coreml-model';
import type { ShotModelPool } from '../../src/cuts/model-pool';
import { TRANSNET_FILE, transNetLoader, type ShotBoundaryModel } from '../../src/cuts/transnet';
import { WINDOW_FRAMES } from '../../src/cuts/windows';
import { createOrtRuntime } from '../../src/onnx/ort';
import { detectShots } from '../../src/shots/detect-shots';
import { componentDir } from '../helpers/offline';
import { makeReel, testMedia } from '../helpers/reel';

const { ctx } = await testMedia('coreml shots parity');
const onnxDir = componentDir('transnetv2', TRANSNET_FILE);
const coremlDir = componentDir('transnetv2-coreml', 'TransNetV2.mlmodelc');
// The helper reads windows from this folder (the suite's, made in beforeAll, symlinks resolved).
let windowsAt: string | undefined;
const windowsDir = async () => {
  if (!windowsAt) throw new Error('beforeAll makes the windows folder');
  await mkdir(windowsAt, { recursive: true });
  return windowsAt;
};
const helper = process.platform === 'darwin' ? await developmentShotsHelper(windowsDir) : undefined;
const missing = !ctx
  ? 'no FFmpeg'
  : !helper?.ok
    ? 'no mac helper'
    : !onnxDir
      ? 'transnetv2 is not in .cache'
      : !coremlDir
        ? 'transnetv2-coreml is not in .cache'
        : '';

/** A deterministic window of texture (xorshift bytes), the values the pass gives: whole numbers 0–255. */
function noiseWindow(seed: number): Float32Array {
  let state = seed;
  const out = new Float32Array(WINDOW_FRAMES * 48 * 27 * 3);
  for (let i = 0; i < out.length; i++) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    // A cut every 30 frames: the texture's brightness jumps.
    out[i] = ((state >>> 0) % 128) + (Math.floor(i / (48 * 27 * 3 * 30)) % 2) * 100;
  }
  return out;
}

describe.skipIf(missing !== '')(`TransNetV2 on Core ML against ONNX ${missing}`, () => {
  let dir: string;
  let onnx: (signal?: AbortSignal) => AsyncResult<ShotBoundaryModel>;
  let coreml: ShotModelPool;

  beforeAll(async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), 'taalcut-coreml-shots-')));
    windowsAt = join(dir, 'windows');
    onnx = transNetLoader(
      createOrtRuntime({ devices: shotModelDevices(process.platform) }),
      async () => onnxDir!,
    );
    coreml = coreMlShotModel({
      helper: helper!.ok
        ? helper!.value
        : {
            windowsDir,
            start: async () => {
              throw new Error('no helper');
            },
          },
      modelDir: async () => coremlDir!,
      units: 'cpuAndGPU',
      idleMs: 60_000,
      startMs: 60_000,
    });
  });
  afterAll(async () => {
    const model = await onnx?.();
    if (model?.ok) await model.value.release();
    await coreml?.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('gives the ONNX model’s probabilities window for window', async () => {
    const [a, b] = [unwrap(await onnx()), unwrap(await coreml.load())];
    expect(b.backend).toBe('coreml');
    let worst = 0;
    for (const seed of [1, 7, 42, 1234]) {
      const window = noiseWindow(seed);
      const [x, y] = [unwrap(await a.predict(window)), unwrap(await b.predict(window))];
      for (const [p, q] of [
        [x.single, y.single],
        [x.manyHot, y.manyHot],
      ] as const) {
        for (let k = 0; k < WINDOW_FRAMES; k++) {
          worst = Math.max(worst, Math.abs(p[k]! - q[k]!));
          expect(p[k]! > 0.5).toBe(q[k]! > 0.5);
        }
      }
    }
    console.warn(`[vision] Core ML against ONNX: max |diff| ${worst.toExponential(2)}`);
    expect(worst).toBeLessThan(1e-4);
  });

  for (const rate of ['25', '30', '60']) {
    it(`finds the same cuts, kinds and spans at ${rate} fps`, async () => {
      const fps = Number(rate);
      const n = Math.round(2.5 * fps);
      const dissolve = Math.round(0.5 * fps);
      const path = join(dir, `reel-${rate}.mp4`);
      await makeReel(
        ctx!,
        path,
        [
          { source: 'testsrc2', frames: n },
          { source: 'smptebars', frames: n },
          { source: 'mandelbrot', frames: n },
          { source: 'cellauto', frames: n },
        ],
        { width: 320, height: 180, rate, dissolves: { 2: dissolve } },
      );
      const [byOnnx, byCoreMl] = [
        unwrap(await detectShots(path, { media: ctx!, boundaryModel: onnx })),
        unwrap(await detectShots(path, { media: ctx!, boundaryModel: (signal) => coreml.load(signal) })),
      ];
      const cuts = (found: typeof byOnnx) =>
        found.cuts.map(({ frame, kind, span, method }) => ({ frame, kind, span, method }));
      expect(byCoreMl.backend).toBe('coreml');
      expect(cuts(byCoreMl)).toEqual(cuts(byOnnx));
      expect(cuts(byCoreMl).map((c) => c.method)).toEqual(['model', 'model', 'model']);
    });
  }
});
