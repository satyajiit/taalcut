// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX-D2: the analysis pass is one decode that gives what three passes gave:
 * every frame's scene score and gray pixels, blackdetect's and
 * freezedetect's intervals (as `analyseVideo` with every 1), every n-th
 * frame's score against the previous sample (as `analyseVideo` with every
 * n), and frame files equal to `sampleFrames`; a file capped at its budget
 * stops early while the other outputs run to the end.
 *
 * Exact on the software decoder. On VideoToolbox two runs of the old path
 * itself differ in a few hundred bytes of a 192×108 frame (measured
 * 2026-10-17: up to 0.7 % of bytes, both old and new paths), so the
 * hardware run is compared within that spread.
 */
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  analyseVideo,
  countedContext,
  createDecodeTally,
  planNormalisation,
  probeMedia,
  readFrameSlots,
  runAnalysisPass,
  sampleFrames,
  type MediaContext,
  type NormalisationPlan,
} from '@taalcut/media';
import { findTestBinaries } from '../helpers/binaries';
import { differingShare } from '../helpers/frame-diff';
import { h264Encoder, renderClip } from '../helpers/clip';

const found = await findTestBinaries('analysis pass');

/** Share of bytes two VideoToolbox reads of the same frames may differ in. */
const VT_SPREAD = 0.02;
const FRAMES = 195;

describe.skipIf(!found.binaries)('the analysis pass', () => {
  let dir: string;
  let ctx: MediaContext;
  let path = '';
  const plans = new Map<string, NormalisationPlan>();

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'taalcut-pass-'));
    ctx = { binaries: found.binaries! };
    const h264 = await h264Encoder(ctx);
    if (!h264) return;
    path = join(dir, 'reel.mp4');
    // A cut at 45, black from 45 to 120 (2.5 s: blackdetect's 2 s minimum), then 2.5 s of still bars (a freeze).
    const made = await renderClip(ctx, path, [
      ...['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=1.5'],
      ...['-f', 'lavfi', '-i', 'color=c=black:size=320x180:rate=30:duration=2.5'],
      ...['-f', 'lavfi', '-i', 'smptebars=size=320x180:rate=30:duration=2.5'],
      ...['-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1[v]', '-map', '[v]', '-g', '30', ...h264],
    ]);
    if (!made) return;
    const probed = await probeMedia(path, ctx);
    if (!probed.ok) return;
    for (const decode of ['software', 'auto'] as const) {
      const plan = planNormalisation(probed.value, { decode });
      if (plan.ok) plans.set(decode, plan.value);
    }
  }, 240_000);
  afterAll(() => rm(dir, { recursive: true, force: true }));

  const ocr = { set: 'ocr', size: { width: 192, height: 108, exact: true }, format: 'rgb24' as const };

  async function pass(plan: NormalisationPlan) {
    const gray = new Map<number, Buffer>();
    const tally = createDecodeTally(path);
    const run = await runAnalysisPass(path, plan, countedContext(ctx, tally), {
      size: 128,
      coarseEvery: 3,
      dir,
      onFrame: (frame) => gray.set(frame.index, frame.data),
      frameSets: [{ ...ocr, every: 30, maxFrames: 3 }],
    });
    if (!run.ok) throw new Error(`${run.error.code}: ${run.error.detail ?? ''}`);
    return { result: run.value, gray, decodes: tally.snapshot() };
  }

  async function old(plan: NormalisationPlan) {
    const gray = new Map<number, Buffer>();
    const full = await analyseVideo(path, plan, ctx, {
      every: 1,
      size: 128,
      thumbnails: true,
      onSample: (sample) => gray.set(sample.index, sample.data),
    });
    const coarse = await analyseVideo(path, plan, ctx, { every: 3, size: 128 });
    const frames = new Map<number, Buffer>();
    const sampled = await sampleFrames(path, plan, ctx, {
      size: { width: 192, height: 108 },
      format: 'rgb24',
      frames: [0, 30, 60],
      onFrame: (frame) => frames.set(frame.index, frame.data),
    });
    if (!full.ok || !coarse.ok || !sampled.ok) throw new Error('old path failed');
    return { full: full.value, coarse: coarse.value, gray, frames };
  }

  it('decodes once and gives what the three old passes gave, byte for byte (software decode)', async (t) => {
    const plan = plans.get('software');
    if (!plan) return t.skip('no clip');
    const { result, gray, decodes } = await pass(plan);
    expect(decodes).toMatchObject({ ffmpeg: 1, fullDecodes: 1, originalFullDecodes: 1 });
    expect(result.frames).toBe(FRAMES);
    expect(result.fine.map((s) => s.index)).toEqual(Array.from({ length: FRAMES }, (_, i) => i));

    const before = await old(plan);
    expect(result.fine.map((s) => [s.score, s.mafd])).toEqual(
      before.full.scenes.map((s) => [s.score, s.mafd ?? 0]),
    );
    expect(result.black).toEqual(before.full.black);
    expect(result.black).toHaveLength(1);
    expect(result.freeze).toEqual(before.full.freeze);
    expect(result.freeze.length).toBeGreaterThan(0);
    expect(gray.size).toBe(FRAMES);
    for (const [index, data] of gray)
      expect(data.equals(before.gray.get(index)!), `frame ${index}`).toBe(true);

    expect(result.coarse.map((s) => s.index)).toEqual(Array.from({ length: 65 }, (_, i) => i * 3));
    expect(result.coarse.map((s) => [s.score, s.mafd])).toEqual(
      before.coarse.scenes.map((s) => [s.score, s.mafd ?? 0]),
    );

    // The OCR set stopped at its 3-frame budget while the analysis ran on to the end.
    const file = result.files[0]!;
    expect(file.slots.map((s) => s.index)).toEqual([0, 30, 60]);
    const read = await readFrameSlots(file.path, file.slots);
    if (!read.ok) throw new Error(read.error.code);
    for (const index of [0, 30, 60])
      expect(read.value.get(index)?.equals(before.frames.get(index)!), `ocr ${index}`).toBe(true);
    expect((await readdir(dir)).filter((name) => name.endsWith('.txt'))).toEqual([]);
  });

  it('matches the old path within its own spread on the hardware decoder (VideoToolbox, NVDEC)', async (t) => {
    const plan = plans.get('auto');
    if (!plan || plan.decode.backend === 'software') return t.skip('no hardware plan');
    const { result, gray } = await pass(plan);
    const before = await old(plan);
    expect(result.frames).toBe(FRAMES);
    expect(result.black).toHaveLength(1);
    expect(result.black[0]!.startSec).toBeCloseTo(before.full.black[0]!.startSec, 1);
    expect(result.freeze.length).toBe(before.full.freeze.length);
    let worst = 0;
    for (const [index, data] of gray) worst = Math.max(worst, differingShare(data, before.gray.get(index)));
    expect(worst).toBeLessThanOrEqual(VT_SPREAD);
    const cut = (scores: readonly { score: number }[]) =>
      scores.reduce((best, s, i) => (s.score > (scores[best]?.score ?? 0) ? i : best), 0);
    expect(cut(result.fine)).toBe(cut(before.full.scenes));
    const file = result.files[0]!;
    const read = await readFrameSlots(file.path, file.slots);
    if (!read.ok) throw new Error(read.error.code);
    for (const index of [0, 30, 60])
      expect(
        differingShare(read.value.get(index), before.frames.get(index)),
        `ocr ${index}`,
      ).toBeLessThanOrEqual(VT_SPREAD);
  });
});
