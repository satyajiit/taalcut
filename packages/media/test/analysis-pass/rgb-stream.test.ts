// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX2-C3: the analysis pass's small RGB stream, the shot-boundary model's input. One decode still: the stream is
 * a tap on the analysis branch. Every `every`-th grid frame at exactly 48×27 (an odd height), in colour while the
 * analysis frames go out gray, numbered on the whole file's grid (a window's too), byte for byte what FFmpeg gives
 * for the same chain run alone on the software decoder, handed over in order while a slow reader reads, and its
 * scratch file gone afterwards.
 */
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  countedContext,
  createDecodeTally,
  planNormalisation,
  probeMedia,
  runAnalysisPass,
  runSegmentedPass,
  type MediaContext,
  type NormalisationPlan,
  type RgbBatch,
} from '@taalcut/media';
import { runFfmpegRaw } from '../../src/run-raw';
import { findTestBinaries } from '../helpers/binaries';
import { h264Encoder, renderClip } from '../helpers/clip';

const found = await findTestBinaries('analysis pass rgb stream');
const FRAMES = 90;
const W = 48;
const H = 27;
const BYTES = W * H * 3;

describe.skipIf(!found.binaries)('the analysis pass’s RGB stream', () => {
  let dir: string;
  let ctx: MediaContext;
  let path = '';
  const plans = new Map<string, NormalisationPlan>();

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'taalcut-stream-'));
    ctx = { binaries: found.binaries! };
    const h264 = await h264Encoder(ctx);
    if (!h264) return;
    path = join(dir, 'reel.mp4');
    // Red, then bars from frame 45: a cut the model's frames must show.
    const made = await renderClip(ctx, path, [
      ...['-f', 'lavfi', '-i', 'color=c=red:size=320x180:rate=30:duration=1.5'],
      ...['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=1.5'],
      ...['-filter_complex', '[0:v][1:v]concat=n=2:v=1[v]', '-map', '[v]', '-g', '30', ...h264],
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

  function collect(delayMs = 0) {
    const batches: RgbBatch[] = [];
    return {
      batches,
      onFrames: async (batch: RgbBatch) => {
        batches.push(batch);
        if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      },
      frames(): Map<number, Buffer> {
        const out = new Map<number, Buffer>();
        for (const b of batches)
          for (let i = 0; i < b.count; i++)
            out.set(b.index + i * b.every, b.data.subarray(i * BYTES, (i + 1) * BYTES));
        return out;
      },
    };
  }

  /** The same chain alone: decode, the analysis size, then bicubic to 48×27 RGB. */
  async function reference(every: number): Promise<Buffer> {
    const chunks: Buffer[] = [];
    const pick = every > 1 ? `select='not(mod(n\\,${every}))',` : '';
    const run = await runFfmpegRaw(
      ctx,
      [
        ...['-i', path, '-an', '-vf', `${pick}scale=128:72,scale=${W}:${H}:flags=bicubic,format=rgb24`],
        ...['-fps_mode', 'passthrough', '-f', 'rawvideo', 'pipe:1'],
      ],
      { onStdout: (chunk: Buffer) => chunks.push(Buffer.from(chunk)) },
    );
    if (!run.ok) throw new Error(`${run.error.code}: ${run.error.detail ?? ''}`);
    return Buffer.concat(chunks);
  }

  it('streams every frame at 48×27 in colour in one decode, as the chain alone gives it (software decode)', async (t) => {
    const plan = plans.get('software');
    if (!plan) return t.skip('no clip');
    const seen = collect(2);
    const tally = createDecodeTally(path);
    let gray = 0;
    const run = await runAnalysisPass(path, plan, countedContext(ctx, tally), {
      size: 128,
      dir,
      // The analysis frames go out gray, as vision reads them; the stream must not turn gray with them.
      onFrame: (frame) => {
        if (frame.data.length === frame.width * frame.height) gray += 1;
      },
      rgbStream: { width: W, height: H, every: 1, onFrames: seen.onFrames },
    });
    if (!run.ok) throw new Error(`${run.error.code}: ${run.error.detail ?? ''}`);
    expect(tally.snapshot()).toMatchObject({ ffmpeg: 1, fullDecodes: 1 });
    expect(run.value.frames).toBe(FRAMES);
    expect(gray).toBe(FRAMES);
    const frames = seen.frames();
    expect([...frames.keys()]).toEqual(Array.from({ length: FRAMES }, (_, i) => i));
    expect(
      seen.batches.every((b) => b.width === W && b.height === H && b.data.length === b.count * BYTES),
    ).toBe(true);
    const alone = await reference(1);
    expect(Buffer.concat([...frames.values()]).equals(alone)).toBe(true);
    // Red before the cut.
    const red = frames.get(10)!;
    expect(red[0]).toBeGreaterThan(200);
    expect(red[1]).toBeLessThan(40);
    expect((await readdir(dir)).filter((name) => name.endsWith('.rgb'))).toEqual([]);
  });

  it('keeps every n-th frame of a window on the whole file’s grid', async (t) => {
    const plan = plans.get('software');
    if (!plan) return t.skip('no clip');
    const seen = collect();
    const run = await runAnalysisPass(path, plan, ctx, {
      size: 128,
      dir,
      window: { from: 30, frames: 60 },
      rgbStream: { width: W, height: H, every: 2, onFrames: seen.onFrames },
    });
    if (!run.ok) throw new Error(run.error.code);
    expect([...seen.frames().keys()]).toEqual(Array.from({ length: 30 }, (_, i) => 30 + i * 2));
    const alone = await reference(2);
    expect(
      seen
        .frames()
        .get(60)!
        .equals(alone.subarray(30 * BYTES, 31 * BYTES)),
    ).toBe(true);
  });

  it('tags each segment’s frames, pre-roll included', async (t) => {
    const plan = plans.get('software');
    if (!plan) return t.skip('no clip');
    const bySegment = new Map<number, number[]>();
    const run = await runSegmentedPass(path, plan, ctx, {
      size: 128,
      dir,
      parallel: 2,
      segments: [
        { start: 0, end: 46, from: 0 },
        { start: 46, end: 90, from: 30 },
      ],
      rgbStream: {
        width: W,
        height: H,
        every: 2,
        onFrames: async (batch, segment) => {
          const list = bySegment.get(segment) ?? [];
          for (let i = 0; i < batch.count; i++) list.push(batch.index + i * batch.every);
          bySegment.set(segment, list);
        },
      },
    });
    if (!run.ok) throw new Error(run.error.code);
    expect(bySegment.get(0)).toEqual(Array.from({ length: 23 }, (_, i) => i * 2));
    expect(bySegment.get(1)).toEqual(Array.from({ length: 30 }, (_, i) => 30 + i * 2));
  });

  it('streams on the hardware decoder too (VideoToolbox, NVDEC), the cut where it is', async (t) => {
    const plan = plans.get('auto');
    if (!plan || plan.decode.backend === 'software') return t.skip('no hardware plan');
    const seen = collect();
    const run = await runAnalysisPass(path, plan, ctx, {
      size: 128,
      dir,
      rgbStream: { width: W, height: H, every: 1, onFrames: seen.onFrames },
    });
    if (!run.ok) throw new Error(run.error.code);
    const frames = seen.frames();
    expect(frames.size).toBe(FRAMES);
    const change = (i: number) => {
      const a = frames.get(i - 1)!;
      const b = frames.get(i)!;
      let sum = 0;
      for (let k = 0; k < BYTES; k++) sum += Math.abs(a[k]! - b[k]!);
      return sum / BYTES;
    };
    const biggest = Array.from({ length: FRAMES - 1 }, (_, i) => i + 1).reduce((best, i) =>
      change(i) > change(best) ? i : best,
    );
    expect(biggest).toBe(45);
  });
});
