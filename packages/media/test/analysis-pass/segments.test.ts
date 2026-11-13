// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX-D7: a pass in segments decoded side by side gives what one pass gives,
 * across the edges: a cut on an edge, a black stretch and a freeze over one,
 * every frame's score and gray pixels, every n-th frame's score and the kept
 * frames. Exact on the software decoder (the hardware decoder's own spread
 * is pinned in run-pass.test.ts). Segment layout and the stitching rules are
 * checked without FFmpeg.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  passSegments,
  planNormalisation,
  probeMedia,
  readFrameSlots,
  runAnalysisPass,
  runSegmentedPass,
  stitchIntervals,
  type AnalysisPassResult,
  type MediaContext,
  type NormalisationPlan,
} from '@taalcut/media';
import { findTestBinaries } from '../helpers/binaries';
import { h264Encoder, renderClip } from '../helpers/clip';

const found = await findTestBinaries('segmented pass');

describe('segment layout and stitching', () => {
  it('splits on the samplings’ multiples, each segment decoding its pre-roll early', () => {
    expect(passSegments(900, { count: 3, minFrames: 100, align: 30, preRoll: 6 })).toEqual([
      { start: 0, end: 300, from: 0 },
      { start: 300, end: 600, from: 270 },
      { start: 600, end: 900, from: 570 },
    ]);
    // Never shorter than minFrames: two segments, not four.
    expect(passSegments(250, { count: 4, minFrames: 100, align: 1, preRoll: 2 })).toHaveLength(2);
    expect(passSegments(50, { count: 4, minFrames: 100, align: 1, preRoll: 2 })).toEqual([
      { start: 0, end: 50, from: 0 },
    ]);
  });

  it('merges a run both segments saw and keeps FFmpeg’s 2 s minimum; touching runs stay apart', () => {
    expect(
      stitchIntervals(
        [
          { startSec: 9, endSec: 10 },
          { startSec: 9.5, endSec: 11.5 },
          { startSec: 20, endSec: 21 },
          { startSec: 30, endSec: 31.5 },
          { startSec: 31.5, endSec: 33 },
        ],
        2,
      ),
    ).toEqual([{ startSec: 9, endSec: 11.5 }]);
  });
});

describe.skipIf(!found.binaries)('a segmented pass', () => {
  let dir: string;
  let ctx: MediaContext;
  let path = '';
  let plan: NormalisationPlan | undefined;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'taalcut-segments-'));
    ctx = { binaries: found.binaries! };
    const h264 = await h264Encoder(ctx);
    if (!h264) return;
    path = join(dir, 'long.mp4');
    // 12 s at 30 fps; edges at 120 and 240 below: a cut at 120, black 6.5–9.5 s and a freeze 9.5–12 s over 240.
    const made = await renderClip(ctx, path, [
      ...['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=4'],
      ...['-f', 'lavfi', '-i', 'mandelbrot=size=320x180:rate=30:end_scale=0.001:inner=period'],
      ...['-f', 'lavfi', '-i', 'color=c=black:size=320x180:rate=30:duration=3'],
      ...['-f', 'lavfi', '-i', 'smptebars=size=320x180:rate=30:duration=2.5'],
      ...[
        '-filter_complex',
        '[1:v]trim=end_frame=75,setpts=PTS-STARTPTS[m];[0:v][m][2:v][3:v]concat=n=4:v=1[v]',
        '-map',
        '[v]',
        '-g',
        '30',
        ...h264,
      ],
    ]);
    if (!made) return;
    const probed = await probeMedia(path, ctx);
    if (!probed.ok) return;
    const planned = planNormalisation(probed.value, { decode: 'software' });
    if (planned.ok) plan = planned.value;
  }, 240_000);
  afterAll(() => rm(dir, { recursive: true, force: true }));

  const options = (gray: Map<number, Buffer>) => ({
    size: 128,
    coarseEvery: 3,
    dir,
    frameSets: [
      {
        set: 'ocr',
        size: { width: 192, height: 108, exact: true },
        format: 'rgb24' as const,
        every: 30,
        maxFrames: 100,
      },
    ],
    onFrame: (frame: { index: number; data: Buffer }) => gray.set(frame.index, frame.data),
  });

  async function slots(result: AnalysisPassResult) {
    const out = new Map<number, Buffer>();
    for (const file of result.files) {
      const read = await readFrameSlots(file.path, file.slots);
      if (read.ok) for (const [index, data] of read.value) out.set(index, data);
    }
    return out;
  }

  it('stitches into what one pass gives, frame for frame', async (t) => {
    if (!plan) return t.skip('no clip');
    const oneGray = new Map<number, Buffer>();
    const one = await runAnalysisPass(path, plan, ctx, options(oneGray));
    if (!one.ok) throw new Error(one.error.code);
    expect(one.value.black).toHaveLength(1);
    expect(one.value.freeze.length).toBeGreaterThan(0);

    const segments = passSegments(plan.frames, { count: 3, minFrames: 100, align: 30, preRoll: 6 });
    expect(segments.map((s) => s.start)).toEqual([0, 120, 240]);
    const splitGray = new Map<number, Buffer>();
    const split = await runSegmentedPass(path, plan, ctx, {
      ...options(splitGray),
      segments,
      parallel: 2,
      onFrame: (frame) => splitGray.set(frame.index, frame.data),
    });
    if (!split.ok) throw new Error(split.error.code);

    expect(split.value.frames).toBe(one.value.frames);
    expect(split.value.fine).toEqual(one.value.fine);
    expect(split.value.coarse).toEqual(one.value.coarse);
    expect(split.value.black).toEqual(one.value.black);
    expect(split.value.freeze.map((f) => [f.startSec, f.endSec])).toEqual(
      one.value.freeze.map((f) => [f.startSec, f.endSec]),
    );
    for (const [index, data] of oneGray)
      expect(splitGray.get(index)?.equals(data), `gray ${index}`).toBe(true);
    const [oneFrames, splitFrames] = [await slots(one.value), await slots(split.value)];
    expect([...splitFrames.keys()].sort((a, b) => a - b)).toEqual([...oneFrames.keys()]);
    for (const [index, data] of oneFrames)
      expect(splitFrames.get(index)?.equals(data), `ocr ${index}`).toBe(true);
  });
});

describe.skipIf(!found.binaries)('every black run (IX3-D2)', () => {
  let dir: string;
  let ctx: MediaContext;
  let path = '';
  let plan: NormalisationPlan | undefined;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'taalcut-black-runs-'));
    ctx = { binaries: found.binaries! };
    const h264 = await h264Encoder(ctx);
    if (!h264) return;
    path = join(dir, 'black.mp4');
    // 8.6 s at 30 fps: black 1.0–1.4 s (a fade's length) and 2.9–5.1 s, then still bars (a freeze) 5.1–7.6 s.
    const made = await renderClip(ctx, path, [
      ...['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=1'],
      ...['-f', 'lavfi', '-i', 'color=c=black:size=320x180:rate=30:duration=0.4'],
      ...['-f', 'lavfi', '-i', 'mandelbrot=size=320x180:rate=30:end_scale=0.001:inner=period'],
      ...['-f', 'lavfi', '-i', 'color=c=black:size=320x180:rate=30:duration=2.2'],
      ...['-f', 'lavfi', '-i', 'smptebars=size=320x180:rate=30:duration=2.5'],
      ...['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=1'],
      ...[
        '-filter_complex',
        '[2:v]trim=end_frame=45,setpts=PTS-STARTPTS[m];[0:v][1:v][m][3:v][4:v][5:v]concat=n=6:v=1[v]',
        '-map',
        '[v]',
        '-g',
        '30',
        ...h264,
      ],
    ]);
    if (!made) return;
    const probed = await probeMedia(path, ctx);
    if (!probed.ok) return;
    const planned = planNormalisation(probed.value, { decode: 'software' });
    if (planned.ok) plan = planned.value;
  }, 240_000);
  afterAll(() => rm(dir, { recursive: true, force: true }));

  const pairs = (runs: readonly { startSec: number; endSec: number }[]) =>
    runs.map((run) => [run.startSec, run.endSec]);

  it('reports every run at d=0, FFmpeg’s 2 s rule over them gives the default’s, and each detector its own', async (t) => {
    if (!plan) return t.skip('no clip');
    const base = { size: 128, coarseEvery: 3 };
    const byDefault = await runAnalysisPass(path, plan, ctx, { ...base, dir });
    const every = await runAnalysisPass(path, plan, ctx, { ...base, dir, detectMinSeconds: 0 });
    if (!byDefault.ok || !every.ok) throw new Error('pass failed');
    expect(pairs(every.value.black)).toEqual([
      [1, 1.4],
      [2.9, 5.1],
    ]);
    expect(byDefault.value.black).toHaveLength(1);
    expect(stitchIntervals(every.value.black, 2)).toEqual(byDefault.value.black);
    expect(byDefault.value.freeze.length).toBeGreaterThan(0);
    expect(pairs(stitchIntervals(every.value.freeze, 2))).toEqual(pairs(byDefault.value.freeze));

    // Each detector at its own minimum, as vision's frame source asks: every black run, freezes at FFmpeg's 2 s.
    const blackOnly = await runAnalysisPass(path, plan, ctx, {
      ...base,
      dir,
      detectMinSeconds: { black: 0 },
    });
    if (!blackOnly.ok) throw new Error('pass failed');
    expect(pairs(blackOnly.value.black)).toEqual(pairs(every.value.black));
    expect(pairs(blackOnly.value.freeze)).toEqual(pairs(byDefault.value.freeze));

    // In segments, at the caller's minimum (0), the long run across the edge at 129 is one run again.
    const segments = passSegments(plan.frames, { count: 2, minFrames: 100, align: 3, preRoll: 6 });
    expect(segments.map((s) => s.start)).toEqual([0, 129]);
    const split = await runSegmentedPass(path, plan, ctx, {
      ...base,
      dir,
      segments,
      parallel: 2,
      detectMinSeconds: 0,
    });
    if (!split.ok) throw new Error(split.error.code);
    expect(pairs(split.value.black)).toEqual(pairs(every.value.black));
    const splitBlackOnly = await runSegmentedPass(path, plan, ctx, {
      ...base,
      dir,
      segments,
      parallel: 2,
      detectMinSeconds: { black: 0 },
    });
    if (!splitBlackOnly.ok) throw new Error(splitBlackOnly.error.code);
    expect(pairs(splitBlackOnly.value.black)).toEqual(pairs(every.value.black));
    expect(pairs(splitBlackOnly.value.freeze)).toEqual(pairs(byDefault.value.freeze));
  });
});
