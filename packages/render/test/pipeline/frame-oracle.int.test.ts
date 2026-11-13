// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Frame-exact cuts at every supported rate (P2-M6, SPEC section 14): a
 * source whose every frame has its own colour is cut into three clips at
 * different in-points; each rendered frame k must show exactly the source
 * frame the timeline puts there, the render has exactly N frames, and the
 * cut frame shows the next clip.
 */
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FrameRate, newId } from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import { renderVideo } from '../../src/engine/render-video';
import { presetFor } from '../../src/presets/presets.v1';
import { ffmpeg, findTestMedia, mediaContext, patchColours, probeJson, tempDir } from '../support/media';
import { findTestShell } from '../support/shell';
import { makeTimeline } from '../support/timeline';
import { FIXTURE_H264 } from '../support/host-video';

const media = await findTestMedia('frame-oracle');
const shell = findTestShell('frame-oracle');
const skip = !media.binaries || !shell.path;

/** The colour lavfi's geq gives source frame n (small primes so neighbours differ a lot). */
const colourOf = (n: number): [number, number, number] => [
  (n * 37 + 20) % 256,
  (n * 91 + 40) % 256,
  (n * 53 + 60) % 256,
];

function nearestFrame(colour: readonly number[], candidates: readonly number[]): number {
  let best = -1;
  let distance = Infinity;
  for (const n of candidates) {
    const d = colourOf(n).reduce((sum, value, index) => sum + (value - (colour[index] ?? 0)) ** 2, 0);
    if (d < distance) {
      distance = d;
      best = n;
    }
  }
  return best;
}

const RATES: readonly [string, FrameRate][] = [
  ['24', FrameRate.of(24)],
  ['30', FrameRate.of(30)],
  ['60', FrameRate.of(60)],
  ['29.97', FrameRate.of(30000, 1001)],
  ['59.94', FrameRate.of(60000, 1001)],
];

describe.skipIf(skip)('frame oracle', { timeout: 240_000 }, () => {
  let ctx: MediaContext;
  let work: Awaited<ReturnType<typeof tempDir>>;

  beforeAll(async () => {
    ctx = mediaContext(media.binaries!);
    work = await tempDir('oracle');
  });
  afterAll(async () => work?.dispose());

  it.each(RATES)('cuts land on their frames at %s fps', async (label, rate) => {
    const rateArg = `${rate.num}/${rate.den}`;
    const source = join(work.dir, `source-${label}.mp4`);
    await ffmpeg(ctx, [
      '-f',
      'lavfi',
      '-i',
      `nullsrc=s=108x192:r=${rateArg}:d=2`,
      '-vf',
      "geq=r='mod(N*37+20,256)':g='mod(N*91+40,256)':b='mod(N*53+60,256)',format=yuv444p",
      '-c:v',
      FIXTURE_H264,
      '-b:v',
      '20M',
      '-pix_fmt',
      'yuv420p',
      source,
    ]);
    const info = await stat(source);
    const assetId = newId<'Asset'>();
    const clips = [
      { frames: 7, sourceStart: 10 },
      { frames: 5, sourceStart: 3 },
      { frames: 9, sourceStart: 20 },
    ];
    const timeline = makeTimeline({
      rate,
      items: clips.map((clip) => ({ ...clip, assetId, mediaFrames: 40, mediaRate: rate })),
    });
    const rendered = await renderVideo({
      timeline,
      preset: presetFor('device'),
      burnCaptions: false,
      source: () => ({ path: source, size: info.size, mtimeMs: info.mtimeMs }),
      ctx,
      conformDir: join(work.dir, 'conform'),
      workDir: join(work.dir, `work-${label}`),
      chromePath: shell.path!,
      browserGpu: 'hardware',
      gpuEncode: true,
      workers: 'auto',
    });
    if (!rendered.ok) throw new Error(`${rendered.error.code}: ${rendered.error.detail ?? ''}`);
    const probe = (await probeJson(ctx, rendered.value.video, 'stream=nb_read_packets,r_frame_rate')) as {
      streams: { nb_read_packets: string; r_frame_rate: string }[];
    };
    expect(Number(probe.streams[0]!.nb_read_packets)).toBe(21);
    expect(probe.streams[0]!.r_frame_rate).toBe(rate.den === 1 ? `${rate.num}/1` : rateArg);

    const expected: number[] = [];
    for (const clip of clips) for (let i = 0; i < clip.frames; i++) expected.push(clip.sourceStart + i);
    const colours = await patchColours(ctx, rendered.value.video, { x: 500, y: 900, size: 16 });
    const candidates = Array.from({ length: 40 }, (_, n) => n);
    expect(colours.map((colour) => nearestFrame(colour, candidates))).toEqual(expected);
  });
});
