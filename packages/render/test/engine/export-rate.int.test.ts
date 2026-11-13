// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { FrameRate, newId } from '@taalcut/core';
import { selectWorkingEncoder } from '@taalcut/media';
import { movingClip, testEngine } from '../support/engine';
import { exportToEnd, failing, queueRender } from '../support/export-record';
import { findTestMedia, mediaContext, probeJson, tempDir } from '../support/media';
import { findTestShell } from '../support/shell';
import { makeTimeline } from '../support/timeline';

const media = await findTestMedia('export-rate');
const shell = findTestShell('export-rate');
let work: Awaited<ReturnType<typeof tempDir>> | undefined;
afterAll(() => work?.dispose());

describe.skipIf(!media.binaries || !shell.path)(
  '30 fps timeline exported at 60 fps',
  { timeout: 300_000 },
  () => {
    it('finishes HEVC through the hardware encoder with twice the frames and the same duration', async (test) => {
      const ctx = mediaContext(media.binaries!);
      const encoder = await selectWorkingEncoder(ctx, 'hevc');
      if (!encoder.ok) return test.skip();
      work = await tempDir('export-rate-finish');
      const file = join(work.dir, 'source.mp4');
      await movingClip(ctx, file, { frames: 60, rate: '30', size: '320x180' });
      const assetId = newId<'Asset'>();
      const original = makeTimeline({ items: [{ frames: 60, sourceStart: 0, mediaFrames: 60, assetId }] });
      const timeline = { ...original, canvas: { ...original.canvas, width: 320, height: 180 } };
      const engine = testEngine(work.dir, ctx, shell.path!);
      engine.assets.set(assetId, file);
      const record = await queueRender(engine, timeline, {
        presetId: 'deviceHevc',
        rate: FrameRate.of(60),
        burnCaptions: false,
      });
      const finished = await exportToEnd(engine, record);
      expect(failing(finished)).toEqual([]);
      expect(finished.status).toBe('ready');
      expect(finished).toMatchObject({ rate: { num: 60, den: 1 }, durationFrames: 120 });
      const probe = await probeJson(
        ctx,
        finished.filePath!,
        'stream=codec_name,avg_frame_rate,nb_read_packets,duration,width,height',
      );
      expect(probe).toMatchObject({
        streams: [
          expect.objectContaining({
            codec_name: 'hevc',
            avg_frame_rate: '60/1',
            nb_read_packets: '120',
            duration: '2.000000',
            width: 320,
            height: 180,
          }),
          expect.objectContaining({ codec_name: 'aac' }),
        ],
      });
      expect(engine.timelines.get(timeline.id)).toEqual(timeline);
      expect(timeline.canvas.rate).toEqual(FrameRate.of(30));
    });
  },
);
