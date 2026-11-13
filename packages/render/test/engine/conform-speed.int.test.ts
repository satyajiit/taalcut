// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A speed ramp is baked on its exact curve (SPEC section 3, "Speed"), with the bundled FFmpeg: every
 * source frame has its own colour, and each conformed frame k must show the source frame the ramp's
 * integral puts there, not the mean speed's. The segment's sound follows the same curve: a click in
 * the source lands on the frame the picture shows it.
 */
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FrameRate, RationalTime, newId } from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import { conformVisual } from '../../src/engine/conform';
import { sourceFramesAt, speedCurve } from '../../src/plan/speed-curve';
import { decodePcm, onset } from '../audio/helpers';
import { ffmpeg, findTestMedia, mediaContext, patchColours, tempDir } from '../support/media';
import { plannedVisual } from '../support/planned';
import { FIXTURE_H264 } from '../support/host-video';

const media = await findTestMedia('conform-speed');
const rate = FrameRate.of(30);
const IN_POINT = 5;
const colourOf = (n: number) => [(n * 37 + 20) % 256, (n * 91 + 40) % 256, (n * 53 + 60) % 256];

function nearestFrame(colour: readonly number[]): number {
  let best = -1;
  let distance = Infinity;
  for (let n = 0; n < 150; n++) {
    const d = colourOf(n).reduce((sum, value, index) => sum + (value - (colour[index] ?? 0)) ** 2, 0);
    if (d < distance) {
      distance = d;
      best = n;
    }
  }
  return best;
}

const speed = {
  curve: 'linear' as const,
  points: [
    { at: RationalTime.of(0, rate), speed: 0.5 },
    { at: RationalTime.of(60, rate), speed: 2 },
  ],
};

describe.skipIf(!media.binaries)('conform speed ramp', { timeout: 240_000 }, () => {
  let ctx: MediaContext;
  let work: Awaited<ReturnType<typeof tempDir>>;

  beforeAll(async () => {
    ctx = mediaContext(media.binaries!);
    work = await tempDir('speed');
  });
  afterAll(async () => work?.dispose());

  it('shows the ramp integral frame by frame and keeps its sound on the picture', async () => {
    const curve = speedCurve(speed, 0, rate);
    // A click in the source where the ramp has played 22.6125 frames: output frame 27.
    const click = Math.round((IN_POINT + sourceFramesAt(curve, 27)) * 1600);
    const source = join(work.dir, 'source.mov');
    await ffmpeg(ctx, [
      '-f',
      'lavfi',
      '-i',
      'nullsrc=s=108x192:r=30:d=5',
      '-f',
      'lavfi',
      '-i',
      `aevalsrc='if(between(n,${click},${click + 95}),0.5,0)':s=48000:c=stereo:d=5`,
      '-vf',
      "geq=r='mod(N*37+20,256)':g='mod(N*91+40,256)':b='mod(N*53+60,256)',format=yuv444p",
      '-c:v',
      FIXTURE_H264,
      '-b:v',
      '20M',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'pcm_s16le',
      source,
    ]);
    const info = await stat(source);
    const visual = plannedVisual(60, {
      sourceIn: RationalTime.of(IN_POINT, rate),
      sourceAtCut: RationalTime.of(IN_POINT, rate),
      speed,
      meanSpeed: 1.25,
    });
    const conformed = await conformVisual(
      visual,
      { path: source, size: info.size, mtimeMs: info.mtimeMs },
      { dir: join(work.dir, `conform-${newId()}`), rate, width: 108, height: 192, ctx },
    );
    if (!conformed.ok) throw new Error(`${conformed.error.code}: ${conformed.error.detail ?? ''}`);

    const shown = (await patchColours(ctx, conformed.value.file, { x: 46, y: 88, size: 16 }))
      .slice(0, 60)
      .map(nearestFrame);
    // The source frame nearest the curve at output frame k (a tie takes the earlier frame).
    const expected = Array.from(
      { length: 60 },
      (_, k) => IN_POINT + Math.ceil(sourceFramesAt(curve, k) + 0.5) - 1,
    );
    expect(shown).toEqual(expected);

    expect(conformed.value.audio).not.toBeNull();
    const pcm = await decodePcm(ctx, conformed.value.audio!);
    expect(pcm.length).toBe(60 * 1600);
    // On the picture's frame: atempo's overlap-add may move an edge by up to half its window (~20 ms).
    expect(Math.abs(onset(pcm, 0.2) - 27 * 1600)).toBeLessThan(1600);
  });
});
