// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { describe, expect, it } from 'vitest';
import { detectEncoders, parseEncoders, type ProcessRunner } from '@taalcut/media';

/** Excerpt of `ffmpeg -hide_banner -encoders` from FFmpeg 9.0.1, plus the OpenH264 line of an LGPL build. */
const ENCODERS = `Encoders:
 V..... = Video
 A..... = Audio
 S..... = Subtitle
 .F.... = Frame-level multithreading
 ..S... = Slice-level multithreading
 ...X.. = Codec is experimental
 ....B. = Supports draw_horiz_band
 .....D = Supports direct rendering method 1
 ------
 V....D libx264              libx264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10 (codec h264)
 V....D libopenh264          OpenH264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10 (codec h264)
 V....D h264_videotoolbox    VideoToolbox H.264 Encoder (codec h264)
 V....D hevc_videotoolbox    VideoToolbox H.265 Encoder (codec hevc)
 VFS..D mjpeg                MJPEG (Motion JPEG)
 V....D prores_videotoolbox  VideoToolbox ProRes Encoder (codec prores)
 A....D aac                  AAC (Advanced Audio Coding)
 A..X.. opus                 Opus
 S..... mov_text             3GPP Timed Text subtitle
`;

describe('parseEncoders', () => {
  const encoders = parseEncoders(ENCODERS);

  it('skips the legend and parses each row', () => {
    expect(encoders.map((e) => e.name)).toEqual([
      'libx264',
      'libopenh264',
      'h264_videotoolbox',
      'hevc_videotoolbox',
      'mjpeg',
      'prores_videotoolbox',
      'aac',
      'opus',
      'mov_text',
    ]);
    expect(encoders.find((e) => e.name === 'h264_videotoolbox')).toEqual({
      name: 'h264_videotoolbox',
      type: 'video',
      codec: 'h264',
      description: 'VideoToolbox H.264 Encoder (codec h264)',
      experimental: false,
      hardware: true,
    });
    expect(encoders.find((e) => e.name === 'mjpeg')).toMatchObject({ codec: 'mjpeg', hardware: false });
    expect(encoders.find((e) => e.name === 'opus')).toMatchObject({ type: 'audio', experimental: true });
    expect(encoders.find((e) => e.name === 'mov_text')?.type).toBe('subtitle');
  });

  it('returns nothing for unexpected output', () => {
    expect(parseEncoders(' V....D looks_like_a_row  but no separator')).toEqual([]);
  });
});

describe('detectEncoders', () => {
  const run =
    (text: string, exitCode = 0): ProcessRunner =>
    async () => ({
      ok: true,
      value: { exitCode, signal: null, stdout: Buffer.from(text), stderrTail: 'boom', durationMs: 1 },
    });
  const binaries = { ffmpeg: '/x/ffmpeg', ffprobe: '/x/ffprobe', source: 'env' } as const;

  it('summarises VideoToolbox and OpenH264 support', async () => {
    // A Mac's listing, read as on a Mac: the preferred encoders follow the platform's rows.
    const result = await detectEncoders({ binaries, runner: run(ENCODERS), platform: 'darwin' });
    expect(result.ok && result.value).toMatchObject({
      h264VideoToolbox: true,
      hevcVideoToolbox: true,
      hardware: { videotoolbox: ['h264_videotoolbox', 'hevc_videotoolbox', 'prores_videotoolbox'] },
      libopenh264: true,
      preferredH264: 'h264_videotoolbox',
      preferredHevc: 'hevc_videotoolbox',
    });
  });

  it("prefers NVENC on Linux, then VA-API, then OpenH264, from BtbN's listing", async () => {
    const btbn = ` ------
 V....D h264_nvenc           NVIDIA NVENC H.264 encoder (codec h264)
 V....D hevc_nvenc           NVIDIA NVENC hevc encoder (codec hevc)
 V....D h264_vaapi           H.264/AVC (VAAPI) (codec h264)
 V....D h264_qsv             H.264 / AVC (Intel Quick Sync Video acceleration) (codec h264)
 V....D libopenh264          OpenH264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10 (codec h264)
`;
    const result = await detectEncoders({ binaries, runner: run(btbn), platform: 'linux' });
    expect(result.ok && result.value).toMatchObject({
      hardware: { cuda: ['h264_nvenc', 'hevc_nvenc'], vaapi: ['h264_vaapi'], qsv: ['h264_qsv'] },
      preferredH264: 'h264_nvenc',
      preferredHevc: 'hevc_nvenc',
    });
  });

  it('falls back to OpenH264 when VideoToolbox is absent', async () => {
    const lgplNoVt = ENCODERS.split('\n')
      .filter((l) => !/videotoolbox|libx264/.test(l))
      .join('\n');
    const result = await detectEncoders({ binaries, runner: run(lgplNoVt) });
    expect(result.ok && result.value).toMatchObject({
      h264VideoToolbox: false,
      preferredH264: 'libopenh264',
      preferredHevc: undefined,
    });
  });

  it('maps a failed run to media.ffmpeg_failed', async () => {
    const result = await detectEncoders({ binaries, runner: run('', 1) });
    expect(!result.ok && result.error.code).toBe('media.ffmpeg_failed');
  });
});
