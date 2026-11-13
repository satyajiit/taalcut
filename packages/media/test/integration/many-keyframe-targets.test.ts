// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-G3: a keyframe-only read with more than 99 targets in one window. `firstAtOrAfter` compared two sums of
 * one `gte` a target, and FFmpeg's expression parser refuses a tree deeper than 100 levels (libavutil/eval.c
 * `MAX_DEPTH`), so a window of 100 targets or more failed with `media.ffmpeg_failed`. On an all-keyframe clip whose
 * grey level is its frame number, 110 targets on the frames and 105 between them come back from one run, each the
 * first keyframe at or after its target.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodeKeyframes, readFrameSlots, type MediaContext } from '@taalcut/media';
import { findTestBinaries } from '../helpers/binaries';
import { h264Encoder } from '../helpers/clip';
import { greyClipArgs, meanLuma, plannedClip, rampLevel, type PlannedClip } from '../helpers/keyframe-clips';

const found = await findTestBinaries('media many keyframe targets');
const FPS = 10;
const FRAMES = 110;

describe.skipIf(!found.binaries)('keyframe reads with many targets', () => {
  let ctx: MediaContext;
  let dir: string;
  let clip: PlannedClip | undefined;

  beforeAll(async () => {
    ctx = { binaries: found.binaries! };
    dir = await mkdtemp(join(tmpdir(), 'taalcut-many-keyframes-'));
    const h264 = await h264Encoder(ctx);
    if (!h264) return;
    // Every frame a keyframe; frame n is grey level 16 + 2n.
    clip = await plannedClip(
      ctx,
      join(dir, 'all-key.mp4'),
      greyClipArgs({
        size: '160x120',
        fps: FPS,
        seconds: FRAMES / FPS,
        gop: 1,
        level: '16+2*N',
        encoder: h264,
      }),
    );
  }, 240_000);
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it.for([
    [
      '110 targets on the frames',
      Array.from({ length: FRAMES }, (_, n) => n / FPS),
      [...Array(FRAMES).keys()],
    ],
    [
      '105 targets between frames',
      Array.from({ length: 105 }, (_, n) => (n + 0.5) / FPS),
      Array.from({ length: 105 }, (_, n) => n + 1),
    ],
  ] as const)(
    '%s: one run, the first keyframe at or after each',
    { timeout: 120_000 },
    async ([, targets, expected], t) => {
      if (!clip) return t.skip('no H.264 encoder');
      const read = await decodeKeyframes(clip.path, clip.plan, ctx, { targets, size: { longSide: 64 }, dir });
      if (!read.ok) throw new Error(`${read.error.code}: ${read.error.detail ?? ''}`);
      if (!read.value) return t.skip('this route cannot skip to keyframes');
      expect(read.value.runs).toBe(1);
      expect(read.value.count).toBe(expected.length);
      const levels: number[] = [];
      for (const file of read.value.files) {
        const slots = await readFrameSlots(file.path, file.slots);
        if (!slots.ok) throw new Error(slots.error.code);
        for (const slot of file.slots) {
          const frame = slots.value.get(slot.index);
          if (frame) levels.push(meanLuma(frame, file.width, file.height));
        }
        await rm(file.path, { force: true });
      }
      // Two levels a frame: the nearest frame number to each picture's level.
      expect(levels.map((level) => Math.round((level - rampLevel(0, 0)) / 2))).toEqual(expected);
    },
  );
});
