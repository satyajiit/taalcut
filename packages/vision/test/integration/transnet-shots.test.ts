// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX2-C4 with the live model on synthetic footage (FFmpeg lavfi, made at test time with the software encoder):
 * TransNetV2 on the analysis pass's stream finds hard cuts to the frame and a dissolve as one, at 24, 25,
 * 29.97, 30 and 60 fps (60 is streamed at 30) and on a variable-frame-rate file, and every shot's time is its
 * first frame on the asset's grid. Runs when the transnetv2 component folder is present (vision SPEC, "Live
 * model runs"); the fallback without it is shots/detect-fallback.test.ts.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RationalTime, unwrap, type AsyncResult, type ComputeFallbackEvent } from '@taalcut/core';
import { runFfmpeg } from '@taalcut/media';
import { softwareH264FixtureFlags } from '@taalcut/media/test-support';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createOrtRuntime } from '../../src/onnx/ort';
import { shotModelDevices } from '../../src/cuts/backends';
import { TRANSNET_FILE, transNetLoader, type ShotBoundaryModel } from '../../src/cuts/transnet';
import { detectShots, type DetectShotsResult } from '../../src/shots/detect-shots';
import { componentDir } from '../helpers/offline';
import { makeReel, testMedia, type Segment } from '../helpers/reel';

const { ctx } = await testMedia('transnet shots');
const modelDir = componentDir('transnetv2', TRANSNET_FILE);

/** Four shots of `seconds` each: hard cut, dissolve of `dissolve` frames centred on the second boundary, hard cut. */
function reel(fps: number, seconds = 2.5): { segments: Segment[]; at: number[]; dissolve: number } {
  const n = Math.round(seconds * fps);
  const dissolve = Math.round(0.5 * fps);
  const segments = [
    { source: 'testsrc2', frames: n },
    { source: 'smptebars', frames: n },
    { source: 'mandelbrot', frames: n },
    { source: 'cellauto', frames: n },
  ];
  // The dissolve starts half its length before the boundary and overlaps the next shot's first frames, so the
  // shots after it start half its length early (helpers/reel.ts).
  return { segments, at: [n, 2 * n, 3 * n - Math.floor(dissolve / 2)], dissolve };
}

function expectTiled(found: DetectShotsResult) {
  const starts = found.shots.map((shot) => shot.start.value);
  expect(starts).toEqual([0, ...found.cuts.map((cut) => cut.frame)]);
  for (const shot of found.shots) expect(shot.start.rate).toEqual(found.frameRate);
  const total = found.shots.reduce((sum, shot) => sum + shot.duration.value, 0);
  expect(total).toBe(found.frameCount);
}

describe.skipIf(!ctx || !modelDir)('TransNetV2 shots on synthetic footage', () => {
  let dir: string;
  let boundaryModel: (signal?: AbortSignal) => AsyncResult<ShotBoundaryModel>;
  const fallbacks: ComputeFallbackEvent[] = [];
  const onFallback = (event: ComputeFallbackEvent) => fallbacks.push(event);

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'taalcut-transnet-'));
    const onnx = createOrtRuntime({ onFallback, devices: shotModelDevices(process.platform) });
    boundaryModel = transNetLoader(onnx, async () => modelDir!);
  });
  afterAll(async () => {
    const model = await boundaryModel?.();
    if (model?.ok) await model.value.release();
    await rm(dir, { recursive: true, force: true });
  });

  for (const rate of ['24', '25', '30000/1001', '30', '60']) {
    it(`finds the hard cuts to the frame and the dissolve at ${rate} fps`, async () => {
      const [num, den = '1'] = rate.split('/');
      const fps = Number(num) / Number(den);
      const { segments, at, dissolve } = reel(fps);
      const path = join(dir, `reel-${rate.replace('/', '-')}.mp4`);
      await makeReel(ctx!, path, segments, { width: 320, height: 180, rate, dissolves: { 2: dissolve } });
      const found = unwrap(await detectShots(path, { media: ctx!, boundaryModel, onFallback }));
      console.warn(
        `[vision] transnet ${rate}: ${found.cuts.map((c) => `${c.frame}${c.kind === 'dissolve' ? 'd' : ''}(${c.score})`).join(' ')}; labelled ${at.join(' ')}`,
      );
      expect(fallbacks).toEqual([]);
      expect(found.cuts.map((cut) => cut.method)).toEqual(['model', 'model', 'model']);
      const [first, soft, last] = found.cuts;
      expect(first).toMatchObject({ kind: 'cut' });
      expect(Math.abs(first!.frame - at[0]!)).toBeLessThanOrEqual(1);
      expect(last).toMatchObject({ kind: 'cut' });
      expect(Math.abs(last!.frame - at[2]!)).toBeLessThanOrEqual(1);
      // The dissolve: one boundary inside the faded frames, its span over them.
      const faded = {
        from: at[1]! - Math.floor(dissolve / 2),
        to: at[1]! - Math.floor(dissolve / 2) + dissolve - 1,
      };
      expect(soft?.kind).toBe('dissolve');
      expect(soft!.frame).toBeGreaterThanOrEqual(faded.from);
      expect(soft!.frame).toBeLessThanOrEqual(faded.to + 1);
      expect(soft!.span!.from).toBeLessThanOrEqual(faded.to);
      expect(soft!.span!.to).toBeGreaterThanOrEqual(faded.from);
      expectTiled(found);
      expect(found.frameRate).toEqual(
        fps === 30000 / 1001 ? { num: 30000, den: 1001 } : { num: fps, den: 1 },
      );
    }, 120_000);
  }

  it('maps the cuts of a variable-frame-rate file to their times', async () => {
    const cfr = join(dir, 'vfr-source.mp4');
    const segments = [
      { source: 'testsrc2', frames: 60 },
      { source: 'smptebars', frames: 60 },
      { source: 'mandelbrot', frames: 60 },
    ];
    await makeReel(ctx!, cfr, segments, { width: 320, height: 180, rate: '30' });
    // The first two seconds at 30 fps, then every third frame (10 fps): r_frame_rate 30, average far lower.
    const vfr = join(dir, 'vfr.mp4');
    const made = await runFfmpeg(ctx!, [
      '-y',
      '-i',
      cfr,
      '-vf',
      "select='lt(n\\,60)+not(mod(n\\,3))'",
      '-fps_mode',
      'vfr',
      ...softwareH264FixtureFlags(),
      '-b:v',
      '2M',
      vfr,
    ]);
    expect(made.ok, JSON.stringify(made)).toBe(true);
    const found = unwrap(await detectShots(vfr, { media: ctx!, boundaryModel, onFallback }));
    const seconds = found.cuts.map((cut) =>
      RationalTime.toSeconds(RationalTime.of(cut.frame, found.frameRate)),
    );
    console.warn(
      `[vision] transnet vfr: cuts at ${seconds.map((s) => s.toFixed(3)).join(' ')} s on ${found.frameRate.num}/${found.frameRate.den}`,
    );
    expect(fallbacks).toEqual([]);
    expect(seconds).toHaveLength(2);
    const step = found.frameRate.den / found.frameRate.num;
    expect(Math.abs(seconds[0]! - 2)).toBeLessThanOrEqual(step + 1e-9);
    // After the change of rate the source has a frame every 0.1 s: the cut is within one of them.
    expect(Math.abs(seconds[1]! - 4)).toBeLessThanOrEqual(0.1 + 1e-9);
    expectTiled(found);
  }, 120_000);
});
