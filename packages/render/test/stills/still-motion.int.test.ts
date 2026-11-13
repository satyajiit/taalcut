// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A still that pushes in (P3-B7, SPEC P3.8), through the real export: each frame is further from the first than
 * the one before (the picture keeps moving the same way), no step between two frames jumps past what the ease
 * allows, and QA's frozenFrames passes (a still is intended to be static).
 */
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FrameRate, timelineSchema, type Timeline } from '@taalcut/core';
import { runProcess, type MediaContext } from '@taalcut/media';
import { easePeakSlope } from '../../src/stills/still-motion';
import { testEngine } from '../support/engine';
import { checkStatus, exportToEnd, failing, queueRender } from '../support/export-record';
import { ffmpeg, findTestMedia, mediaContext, tempDir } from '../support/media';
import { findTestShell } from '../support/shell';
import { makeTimeline } from '../support/timeline';

const media = await findTestMedia('still motion');
const shell = findTestShell('still motion');
const rate = FrameRate.of(30);
const FRAMES = 90;
const SMALL = { width: 72, height: 128 };

/** Every frame of a video, grey, at a small size. */
async function greyFrames(ctx: MediaContext, path: string): Promise<Uint8Array[]> {
  const run = await runProcess(
    ctx.binaries.ffmpeg,
    [
      '-v',
      'error',
      '-i',
      path,
      '-vf',
      `scale=${SMALL.width}:${SMALL.height}:flags=area,format=gray`,
      '-f',
      'rawvideo',
      '-',
    ],
    { timeoutMs: 120_000, maxStdoutBytes: 64 * 1024 * 1024 },
  );
  if (!run.ok) throw new Error(`decode failed: ${run.error.code}`);
  const size = SMALL.width * SMALL.height;
  const bytes = new Uint8Array(run.value.stdout);
  return Array.from({ length: Math.floor(bytes.length / size) }, (_, index) =>
    bytes.subarray(index * size, (index + 1) * size),
  );
}

/** Mean absolute difference of two grey frames, in levels. */
const distance = (a: Uint8Array, b: Uint8Array) =>
  a.reduce((sum, value, index) => sum + Math.abs(value - (b[index] ?? 0)), 0) / a.length;

describe.skipIf(!media.binaries || !shell.path)(
  'still motion, rendered (P3-B7)',
  { timeout: 600_000 },
  () => {
    let ctx: MediaContext;
    let work: Awaited<ReturnType<typeof tempDir>>;

    beforeAll(async () => {
      ctx = mediaContext(media.binaries!);
      work = await tempDir('still-motion');
    });
    afterAll(async () => work?.dispose());

    it('pushes in steadily and gently, and QA sees it as intended', async () => {
      const still = join(work.dir, 'still.jpg');
      // A detailed picture: every scale step shows in the difference.
      await ffmpeg(ctx, ['-f', 'lavfi', '-i', 'testsrc2=s=1080x1920', '-frames:v', '1', '-q:v', '2', still]);
      const engine = testEngine(join(work.dir, 'engine'), ctx, shell.path!);
      const base = makeTimeline({ rate, items: [{ frames: FRAMES, kind: 'image' }] });
      const timeline: Timeline = timelineSchema.parse({
        ...base,
        tracks: base.tracks.map((track) =>
          track.kind === 'video'
            ? {
                ...track,
                items: track.items.map((item) =>
                  item.type === 'clip' ? { ...item, stillMotion: 'pushIn' } : item,
                ),
              }
            : track,
        ),
      });
      for (const track of timeline.tracks)
        if (track.kind === 'video')
          for (const item of track.items)
            if (item.type === 'clip') engine.assets.set(item.media.assetId, still);
      const stored = await exportToEnd(engine, await queueRender(engine, timeline));
      expect(failing(stored)).toEqual([]);
      expect(checkStatus(stored, 'frozenFrames')).toBe('pass');
      expect(stored.status).toBe('ready');
      const file = stored.filePath;
      if (!file) throw new Error('not delivered');

      const frames = await greyFrames(ctx, file);
      expect(frames).toHaveLength(FRAMES);
      const first = frames[0] ?? new Uint8Array();
      const fromFirst = frames.map((frame) => distance(frame, first));
      const steps = frames.slice(1).map((frame, index) => distance(frame, frames[index] ?? frame));
      const total = fromFirst.at(-1) ?? 0;
      // It moved: the last frame is clearly not the first.
      expect(total).toBeGreaterThan(3);
      // Steadily: each frame is at least as far from the first as the one before (encoder noise aside).
      for (let index = 1; index < fromFirst.length; index++)
        expect(fromFirst[index], `frame ${index}`).toBeGreaterThanOrEqual((fromFirst[index - 1] ?? 0) - 0.5);
      // Gently: no step jumps past the ease's fastest pace (with room for the encoder's GOP).
      const meanStep = steps.reduce((sum, step) => sum + step, 0) / steps.length;
      expect(Math.max(...steps)).toBeLessThanOrEqual(meanStep * easePeakSlope() * 2);
      console.warn(
        `[still motion] distance to first frame ${total.toFixed(2)}, mean step ${meanStep.toFixed(3)}, ` +
          `largest ${Math.max(...steps).toFixed(3)}`,
      );
    });
  },
);
