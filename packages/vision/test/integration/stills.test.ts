// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A photo is one shot of one frame (the library gives a still that shot):
 * analysis and the embedding frames read it through media's still path
 * (its pipe demuxer, never image2), at a phone camera's 4032×3024.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RationalTime, type FrameRate } from '@taalcut/core';
import { runFfmpeg } from '@taalcut/media';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { analyzeShots } from '../../src/analysis/analyze-shots';
import { embeddingFrameSize } from '../../src/embed/space';
import { probeSource, sampleFrames } from '../../src/media/frames';
import { testMedia } from '../helpers/reel';

const { ctx } = await testMedia('stills');
const STILL_RATE: FrameRate = { num: 1, den: 1 };
const ONE_FRAME = { start: RationalTime.of(0, STILL_RATE), duration: RationalTime.of(1, STILL_RATE) };

describe.skipIf(!ctx)('a photo as one shot', () => {
  let dir: string;
  const photos: Record<string, string> = {};

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'taalcut-stills-'));
    for (const name of ['IMG_0001.JPG', 'photo.jpg', 'photo.png']) {
      const path = join(dir, name);
      const made = await runFfmpeg(ctx!, [
        ...['-y', '-f', 'lavfi', '-i', 'testsrc2=size=4032x3024', '-frames:v', '1', path],
      ]);
      if (!made.ok) throw new Error(`${name}: ${made.error.code} ${made.error.detail ?? ''}`);
      photos[name] = path;
    }
  }, 120_000);
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it('analyses a 4032×3024 .jpg, .JPG and .png as its one-frame shot', async () => {
    for (const [name, path] of Object.entries(photos)) {
      const analysed = await analyzeShots(
        { path, shots: [{ shotId: 'still', range: ONE_FRAME }] },
        { media: ctx! },
      );
      if (!analysed.ok) throw new Error(`${name}: ${analysed.error.code} ${analysed.error.detail ?? ''}`);
      expect(analysed.value).toHaveLength(1);
      const [shot] = analysed.value;
      expect(shot!.analysis).toMatchObject({ orientation: 'landscape', bestFrame: 0 });
      expect(shot!.analysis.quality.sharpness).toBeGreaterThan(0.5);
      expect(shot!.analysis.signals!.sharpnessCurve).toHaveLength(10);
      expect(shot!.analysis.signals!.motionPeakFrames).toEqual([]);
    }
  }, 120_000);

  it('reads the embedding frame of a photo at the model’s exact size', async () => {
    const source = await probeSource(ctx!, photos['photo.jpg']!);
    if (!source.ok) throw new Error(source.error.code);
    expect(source.value).toMatchObject({ width: 4032, height: 3024, frameCount: 1 });
    const size = embeddingFrameSize(source.value.width, source.value.height);
    const frames = await sampleFrames(ctx!, source.value, { size, format: 'rgb24', frames: [0] });
    if (!frames.ok) throw new Error(frames.error.code);
    expect(frames.value).toHaveLength(1);
    expect(frames.value[0]).toMatchObject({ index: 0, ...size });
    expect(frames.value[0]!.data.length).toBe(size.width * size.height * 3);
  }, 120_000);
});
