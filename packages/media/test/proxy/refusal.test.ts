// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A proxy whose VideoToolbox session is refused (IX3-K4): the encode runs once more on software decode and
 * libopenh264 with the same flags, says so through `compute.fallback`, and declares no video session (IX3-K2). Only
 * when nothing was written: a run that wrote output, or failed for another reason, is not repeated. FFmpeg never
 * runs; the runner plays it.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ok, type ComputeFallbackEvent } from '@taalcut/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeProxy, type MediaContext, type ProcessRunner, type RunOptions } from '@taalcut/media';
import { videoPlan } from '../helpers/video-plan';

const ENCODERS = ` ------
 V..... h264_videotoolbox    VideoToolbox H.264 Encoder (codec h264)
 V..... libopenh264          OpenH264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10 (codec h264)
 A..... aac                  AAC (Advanced Audio Coding)
`;
/** FFmpeg's line when VideoToolbox gives the encoder no session (libavcodec/videotoolboxenc.c). */
const ENCODER_REFUSED = '[h264_videotoolbox @ 0x1] Cannot create compression session: -12902\n';

const done = (stdout = '') =>
  ok({ exitCode: 0, signal: null, stdout: Buffer.from(stdout), stderrTail: '', durationMs: 1 });
const failed = (stderrTail: string) =>
  ok({ exitCode: 1, signal: null, stdout: Buffer.alloc(0), stderrTail, durationMs: 1 });

interface Encode {
  readonly args: string;
  readonly holdsVideoSession: boolean | undefined;
}

let dir: string;
let out: string;
let encodes: Encode[];
let events: ComputeFallbackEvent[];
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'taalcut-proxy-refusal-'));
  out = join(dir, 'proxy.mp4');
  encodes = [];
  events = [];
});
afterEach(() => rm(dir, { recursive: true, force: true }));

/** The proxy's encodes go to `encode`; the encoder listing and the trial encode succeed. */
function context(encode: (args: string, n: number) => Promise<ReturnType<typeof done>>): MediaContext {
  const runner: ProcessRunner = async (_command, args, options?: RunOptions) => {
    const text = args.join(' ');
    if (text.includes('-encoders')) return done(ENCODERS);
    if (text.includes('testsrc2')) return done();
    encodes.push({ args: text, holdsVideoSession: options?.holdsVideoSession });
    return encode(text, encodes.length);
  };
  return {
    binaries: { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe', source: 'dev-build' },
    runner,
    // A Mac: the plan below is VideoToolbox's, and so is the encoder the trial proves.
    platform: 'darwin',
    onComputeFallback: (event) => events.push(event),
  };
}

/** A 4K clip, so the proxy is scaled to its 1280 rung. */
const UHD = { width: 3840, height: 2160, displayWidth: 3840, displayHeight: 2160 };
const proxyOf = (ctx: MediaContext, sizeBytes = 50_000_000, withAudio = false) =>
  makeProxy('/clip.mp4', videoPlan(UHD, withAudio, 'darwin'), ctx, { out, sizeBytes });

describe('a proxy VideoToolbox refuses', () => {
  it('runs once more on software decode and Apple CPU encode, with the same GOP, size and colour flags', async () => {
    const ctx = context(async (_args, n) => {
      if (n === 1) return failed(ENCODER_REFUSED);
      await writeFile(out, Buffer.alloc(1000));
      return done();
    });
    const result = await proxyOf(ctx);
    expect(result.ok).toBe(true);
    expect(encodes).toHaveLength(2);
    const [hardware, software] = encodes;
    expect(hardware?.args).toContain('-hwaccel videotoolbox');
    expect(hardware?.args).toContain('-c:v h264_videotoolbox');
    expect(hardware?.holdsVideoSession).toBe(true);
    expect(software?.args).not.toContain('-hwaccel');
    expect(software?.args).toContain('-c:v h264_videotoolbox -require_sw 1');
    expect(hardware?.args).not.toContain('-require_sw');
    expect(software?.holdsVideoSession).toBe(false);
    for (const flags of [
      '-g 15',
      '-bf 0',
      '-pix_fmt yuv420p',
      '-color_primaries bt709',
      '-color_trc bt709',
    ]) {
      expect(software?.args).toContain(flags);
    }
    expect(software?.args).toContain('-bsf:v h264_metadata=colour_primaries=1');
    expect(software?.args).not.toContain('-allow_sw');
    // The same size: the hardware run scales on the GPU, the software one on the CPU, both to the 1280 rung.
    expect(hardware?.args).toContain('scale_vt=w=1280:h=720');
    expect(software?.args).toContain('scale=1280:720');
    expect(events).toEqual([
      expect.objectContaining({ operation: 'media.decode', reason: 'accelerator_failed' }),
      expect.objectContaining({
        operation: 'media.encode',
        reason: 'accelerator_failed',
        detail: 'the VideoToolbox encoder would not start (-12902)',
      }),
    ]);
  });

  it('re-encodes the over-budget audio on the route that worked', async () => {
    const ctx = context(async (_args, n) => {
      if (n === 1) return failed(ENCODER_REFUSED);
      await writeFile(out, Buffer.alloc(2_000_000));
      return done();
    });
    const result = await proxyOf(ctx, 10_000_000, true);
    expect(result.ok && result.value.overBudget).toBe(true);
    expect(encodes.map((encode) => /-c:v (\S+)/.exec(encode.args)?.[1])).toEqual([
      'h264_videotoolbox',
      'h264_videotoolbox',
      'h264_videotoolbox',
    ]);
    expect(encodes.map((encode) => encode.args.includes('-require_sw 1'))).toEqual([false, true, true]);
    expect(encodes[2]?.args).toContain('-b:a 64k');
  });

  it('is not repeated once the run wrote output', async () => {
    const ctx = context(async () => {
      await writeFile(out, Buffer.alloc(1000));
      return failed(ENCODER_REFUSED);
    });
    const result = await proxyOf(ctx);
    expect(!result.ok && result.error.code).toBe('media.ffmpeg_failed');
    expect(encodes).toHaveLength(1);
    expect(events).toEqual([]);
  });

  it('is not repeated for any other failure', async () => {
    const ctx = context(() => Promise.resolve(failed('Invalid data found when processing input\n')));
    const result = await proxyOf(ctx);
    expect(!result.ok && result.error.code).toBe('media.ffmpeg_failed');
    expect(encodes).toHaveLength(1);
    expect(events).toEqual([]);
  });
});
