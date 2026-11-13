// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Stills are GPU first like clips (SPEC section 4, "GPU first"): a file VideoToolbox can decode takes
 * that route; a JPEG (no VideoToolbox decoder) takes the CPU scale and says so with
 * `render.conformStill` / `unsupported_input`; a hardware run that fails is redone in software and
 * reported as `accelerator_failed`. Either way the still is made.
 */
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { err, FrameRate, newId } from '@taalcut/core';
import { FfmpegFailed, runProcess, type MediaContext, type ProcessRunner } from '@taalcut/media';
import { conformVisual, type ConformedSegment } from '../../src/engine/conform';
import { ffmpeg, findTestMedia, mediaContext, tempDir } from '../support/media';
import { plannedVisual } from '../support/planned';
import { FIXTURE_H264, hostVideo, type HostVideo } from '../support/host-video';

const media = await findTestMedia('conform-still');
const rate = FrameRate.of(30);

describe.skipIf(!media.binaries)('conform still', { timeout: 240_000 }, () => {
  let ctx: MediaContext;
  let host: HostVideo;
  let work: Awaited<ReturnType<typeof tempDir>>;
  let jpeg: string;
  let h264: string;

  beforeAll(async () => {
    ctx = mediaContext(media.binaries!);
    host = await hostVideo(ctx);
    work = await tempDir('still');
    jpeg = join(work.dir, 'photo.jpg');
    await ffmpeg(ctx, ['-f', 'lavfi', '-i', 'color=c=red:s=96x128', '-frames:v', '1', jpeg]);
    // A still VideoToolbox can decode (HEIC photos are HEVC; H.264 stands in for the test).
    h264 = join(work.dir, 'photo.mp4');
    await ffmpeg(ctx, [
      '-f',
      'lavfi',
      '-i',
      'color=c=blue:s=96x128:r=30',
      '-frames:v',
      '1',
      '-c:v',
      FIXTURE_H264,
      '-pix_fmt',
      'yuv420p',
      h264,
    ]);
  });
  afterAll(async () => work?.dispose());

  const conformStill = async (path: string, context: MediaContext) => {
    const fallbacks: [string, string, string][] = [];
    const info = await stat(path);
    const result = await conformVisual(
      plannedVisual(30, { kind: 'image' }),
      { path, size: info.size, mtimeMs: info.mtimeMs },
      {
        dir: join(work.dir, `conform-${newId()}`),
        rate,
        width: 108,
        height: 192,
        ctx: context,
        onFallback: (event) => fallbacks.push([event.operation, event.reason, event.detail ?? '']),
      },
    );
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.detail ?? ''}`);
    return { segment: result.value, fallbacks };
  };

  const made = async (segment: ConformedSegment) => (await stat(segment.file)).size > 0;

  it('logs compute.fallback when a JPEG takes the CPU scale', async () => {
    const { segment, fallbacks } = await conformStill(jpeg, ctx);
    expect(segment.decode).toBe('software');
    // A row that decodes stills names the codec; one that decodes none (NVDEC), or none at all, says so.
    const why = host.decodesStills ? /mjpeg/ : /\S/;
    const reason = host.decode ? 'unsupported_input' : 'no_accelerator';
    expect(fallbacks).toEqual([['render.conformStill', reason, expect.stringMatching(why)]]);
    expect(await made(segment)).toBe(true);
  });

  it("decodes a still on the machine's row when it reads stills, with nothing to report", async () => {
    const { segment, fallbacks } = await conformStill(h264, ctx);
    expect(segment.decode).toBe(host.decodesStills ? host.decode : 'software');
    expect(fallbacks).toHaveLength(host.decodesStills ? 0 : 1);
    expect(await made(segment)).toBe(true);
  });

  it('redoes a failed hardware run in software and reports it', async (test) => {
    if (!host.decodesStills) return test.skip();
    // The hardware run fails the way a hardware decode error does: a non-zero ffmpeg exit.
    const failing: ProcessRunner = (command, args, options) =>
      args.includes('-hwaccel')
        ? Promise.resolve(err(FfmpegFailed({ exitCode: 1 }, { detail: 'hardware said no' })))
        : runProcess(command, args, options);
    const { segment, fallbacks } = await conformStill(h264, { ...ctx, runner: failing });
    expect(segment.decode).toBe('software');
    expect(fallbacks).toEqual([
      ['render.conformStill', 'accelerator_failed', expect.stringMatching(/hardware said no/)],
    ]);
    expect(await made(segment)).toBe(true);
    expect(segment.fallback).toMatch(/^VideoToolbox failed/);
  });
});
