// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * vision.describeFrame with real FFmpeg frame extraction (a portrait phone-style
 * clip made in setup) and a scripted model. Skips when no FFmpeg is installed.
 */
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ok } from '@taalcut/core';
import {
  createDirectJobRunner,
  createMediaJobs,
  createMediaService,
  detectEncoders,
  runFfmpeg,
} from '@taalcut/media';
import { testFfmpegFor } from '@taalcut/media/test-support';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { describeFrameOutputSchema, visionToolModule } from '@taalcut/vision';
import { GEMINI, mutableSelector, scriptedClient, testRuntime, testToolContext } from '../helpers/fakes';

// The run's FFmpeg, checked once before any file started (media's test-support-ffmpeg.ts).
const { binaries } = testFfmpegFor(inject('testFfmpeg'), 'vision integration');

describe.skipIf(!binaries)(`describeFrame with real FFmpeg${binaries ? '' : ' (no FFmpeg found)'}`, () => {
  let dir: string;
  let clip: string | undefined;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'taalcut-vision-'));
    const ctx = { binaries: binaries! };
    const encoders = await detectEncoders(ctx);
    const h264 = ['libx264', 'libopenh264', 'h264_videotoolbox'].find((name) =>
      encoders.ok ? encoders.value.encoders.some((e) => e.name === name) : false,
    );
    if (!h264) return;
    const landscape = join(dir, 'landscape.mp4');
    const made = await runFfmpeg(ctx, [
      ...['-y', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30', '-t', '1'],
      ...['-c:v', h264, '-pix_fmt', 'yuv420p', landscape],
    ]);
    if (!made.ok) return;
    // Display matrix of an iPhone portrait clip: coded 1280x720, shown 720x1280.
    const portrait = join(dir, 'portrait.mov');
    const rotated = await runFfmpeg(ctx, [
      '-y',
      '-display_rotation',
      '-90',
      '-i',
      landscape,
      '-c',
      'copy',
      portrait,
    ]);
    if (rotated.ok) clip = portrait;
  });

  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('sends an upright JPEG no larger than the detail level allows', async (t) => {
    if (!clip) t.skip('could not make the fixture clip with this FFmpeg build');
    const media = createMediaService({ resolver: { resolve: async () => ok(binaries!) } });
    const models = scriptedClient(() => [
      { choice: GEMINI, local: false, outcome: { text: 'Colour bars.' } },
    ]);
    const tool = visionToolModule({
      jobs: createDirectJobRunner(createMediaJobs(media)),
      models,
      selector: mutableSelector([GEMINI]),
      runtime: testRuntime(),
    }).tools[0]!;

    const result = await tool.run(
      { path: clip, at: { value: 15, rate: 30 }, detail: 'normal' },
      testToolContext(),
    );
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.detail ?? ''}`);
    expect(describeFrameOutputSchema.parse(result.value).frame).toEqual({ width: 432, height: 768 });

    const message = models.requests[0]?.messages[0];
    const content = message?.role === 'user' ? message.content : undefined;
    const image = Array.isArray(content) ? content.find((part) => part.type === 'image') : undefined;
    expect(image).toMatchObject({ mimeType: 'image/jpeg' });
    const bytes = Buffer.from(image?.type === 'image' ? image.data : '', 'base64');
    expect(bytes.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    expect(bytes.length).toBeLessThan(200_000);
  });

  it("reads a breakdown's reference frame from scratch, logged against the project", async (t) => {
    if (!clip) t.skip('could not make the fixture clip with this FFmpeg build');
    // A breakdown leaves JPEG frames in <userData>/scratch/<experimentId>/frames.
    const frames = join(dir, 'scratch', '01J0000000000000000000000X', 'frames');
    await mkdir(frames, { recursive: true });
    const still = join(frames, 'frame-000015.jpg');
    const made = await runFfmpeg({ binaries: binaries! }, ['-y', '-i', clip!, '-frames:v', '1', still]);
    if (!made.ok) throw new Error(made.error.detail);
    const media = createMediaService({ resolver: { resolve: async () => ok(binaries!) } });
    const models = scriptedClient(() => [{ choice: GEMINI, local: false, outcome: { text: 'A street.' } }]);
    const tool = visionToolModule({
      jobs: createDirectJobRunner(createMediaJobs(media)),
      models,
      selector: mutableSelector([GEMINI]),
      runtime: testRuntime(),
    }).tools[0]!;
    expect(tool.permission?.filesystem?.read).toContain('scratch');
    const projectId = '01J00000000000000000000PRJ';
    const result = await tool.run(
      { path: still, at: { value: 0, rate: 1 }, detail: 'low', projectId },
      testToolContext(),
    );
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.detail ?? ''}`);
    expect(models.requests[0]?.trace?.projectId).toBe(projectId);
  });
});
