// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Grid sampling as vision reads it: a range seeks and then counts from its
 * start, `every` keeps every n-th grid frame, explicit frames come back in
 * order, an exact size is exact even past the source's; each frame is the
 * same bytes a full pass reads at that index. analyseVideo on the grid
 * scores a hard cut on its frame.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RationalTime, type FrameRate } from '@taalcut/core';
import { analyseVideo, sampleFrames, type MediaContext, type NormalisationPlan } from '@taalcut/media';
import { findTestBinaries } from '../helpers/binaries';
import { h264Encoder, planClip, renderClip } from '../helpers/clip';

const found = await findTestBinaries('media sampling');
const SIZE = { width: 64, height: 48 };

describe.skipIf(!found.binaries)('grid sampling', () => {
  let dir: string;
  let ctx: MediaContext;
  let path = '';
  let plan: NormalisationPlan | undefined;
  const full = new Map<number, Buffer>();

  const sample = async (options: Omit<Parameters<typeof sampleFrames>[3], 'onFrame' | 'format'>) => {
    const frames: { index: number; data: Buffer; width: number; height: number }[] = [];
    const done = await sampleFrames(path, plan!, ctx, {
      format: 'gray8',
      ...options,
      onFrame: (frame) => frames.push(frame),
    });
    if (!done.ok) throw new Error(`${done.error.code}: ${done.error.detail ?? ''}`);
    return frames;
  };
  const at = (frame: number, rate: FrameRate) => RationalTime.of(frame, rate);

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'taalcut-sampling-'));
    ctx = { binaries: found.binaries! };
    const h264 = await h264Encoder(ctx);
    if (!h264) return;
    path = join(dir, 'cut.mp4');
    // 1.5 s of testsrc2, then a hard cut to smptebars at frame 45; keyframes every 30 frames.
    const ok = await renderClip(ctx, path, [
      ...['-f', 'lavfi', '-i', 'testsrc2=size=160x120:rate=30:duration=1.5'],
      ...['-f', 'lavfi', '-i', 'smptebars=size=160x120:rate=30:duration=1.5'],
      ...['-filter_complex', '[0:v][1:v]concat=n=2:v=1[v]', '-map', '[v]', '-g', '30', ...h264],
    ]);
    if (!ok) return;
    const planned = await planClip(path, ctx);
    if (planned.ok) plan = planned.value;
    for (const frame of await sample({ size: SIZE })) full.set(frame.index, frame.data);
  }, 240_000);
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it('reads the whole grid once, one frame per index', (t) => {
    if (!plan) return t.skip('no clip');
    expect(full.size).toBe(90);
  });

  it('counts a range from its start, and every n-th frame from there, byte for byte', async (t) => {
    if (!plan) return t.skip('no clip');
    const rate = plan.frameRate.output;
    const window = await sample({ size: SIZE, range: { start: at(37, rate), duration: at(20, rate) } });
    expect(window.map((f) => f.index)).toEqual(Array.from({ length: 20 }, (_, i) => i));
    for (const frame of window) expect(frame.data.equals(full.get(37 + frame.index)!)).toBe(true);
    const every = await sample({
      size: SIZE,
      every: 3,
      range: { start: at(33, rate), duration: at(21, rate) },
    });
    expect(every.map((f) => f.index)).toEqual([0, 3, 6, 9, 12, 15, 18]);
    for (const frame of every) expect(frame.data.equals(full.get(33 + frame.index)!)).toBe(true);
    const whole = await sample({ size: SIZE, every: 10 });
    expect(whole.map((f) => f.index)).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80]);
    for (const frame of whole) expect(frame.data.equals(full.get(frame.index)!)).toBe(true);
  }, 120_000);

  it('returns explicit frames in index order, and an exact size past the source', async (t) => {
    if (!plan) return t.skip('no clip');
    const picked = await sample({ size: SIZE, frames: [44, 2, 45] });
    expect(picked.map((f) => f.index)).toEqual([2, 44, 45]);
    for (const frame of picked) expect(frame.data.equals(full.get(frame.index)!)).toBe(true);
    const big = await sample({ size: { width: 224, height: 112 }, frames: [0] });
    expect(big).toHaveLength(1);
    expect(big[0]).toMatchObject({ width: 224, height: 112 });
    expect(big[0]!.data.length).toBe(224 * 112);
  }, 120_000);

  it('scores the hard cut on its own frame on the grid, also inside a range', async (t) => {
    if (!plan) return t.skip('no clip');
    const rate = plan.frameRate.output;
    const fps = rate.num / rate.den;
    const peak = (scenes: readonly { timeSec: number; score: number }[]) =>
      scenes.reduce((best, s) => (s.score > best.score ? s : best)).timeSec;
    const all = await analyseVideo(path, plan, ctx, { every: 1, size: 64 });
    if (!all.ok) throw new Error(all.error.code);
    expect(all.value.scenes).toHaveLength(90);
    expect(Math.round(peak(all.value.scenes) * fps)).toBe(45);
    const ranged = await analyseVideo(path, plan, ctx, {
      every: 1,
      size: 64,
      range: { start: at(30, rate), duration: at(30, rate) },
    });
    if (!ranged.ok) throw new Error(ranged.error.code);
    expect(Math.round(peak(ranged.value.scenes) * fps)).toBe(15);
    const coarse = await analyseVideo(path, plan, ctx, { every: 3, size: 64 });
    if (!coarse.ok) throw new Error(coarse.error.code);
    expect(coarse.value.scenes).toHaveLength(30);
    expect(Math.round(peak(coarse.value.scenes) * fps) * 3).toBe(45);
  }, 120_000);
});
