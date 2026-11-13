// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Backend selection without FFmpeg (ADR 0002): hardware first, and every software pick carries a reason. */
import { describe, expect, it } from 'vitest';
import {
  fitWithin,
  HardwareFailures,
  parseEncoders,
  planDecode,
  selectEncoder,
  videoToolboxSurfaceFormat,
} from '@taalcut/media';
import { videoStream } from './helpers/probe-fixture';

const HEAD = ' V..... = Video\n ------\n';
const line = (name: string, codec: string) => ` V....D ${name.padEnd(20)} ${name} (codec ${codec})`;
const build = (...rows: [string, string][]) =>
  parseEncoders(HEAD + rows.map(([n, c]) => line(n, c)).join('\n'));

/** The shipped LGPL build on a Mac. */
const LGPL_MAC = build(
  ['h264_videotoolbox', 'h264'],
  ['hevc_videotoolbox', 'hevc'],
  ['prores_videotoolbox', 'prores'],
  ['prores_ks', 'prores'],
);
/** An LGPL build without VideoToolbox (a Linux build, or a Mac build configured without it). */
const LGPL_PLAIN = build(['libopenh264', 'h264'], ['prores_ks', 'prores']);
/** Homebrew's GPL build: VideoToolbox and x264/x265, no OpenH264. */
const HOMEBREW = build(
  ['libx264', 'h264'],
  ['libx265', 'hevc'],
  ['h264_videotoolbox', 'h264'],
  ['hevc_videotoolbox', 'hevc'],
);

describe('selectEncoder', () => {
  it('picks VideoToolbox on macOS, with no fallback reason', () => {
    for (const codec of ['h264', 'hevc', 'prores'] as const) {
      const choice = selectEncoder(codec, LGPL_MAC, { platform: 'darwin' });
      expect(choice).toEqual({
        ok: true,
        value: { codec, encoder: `${codec}_videotoolbox`, backend: 'videotoolbox' },
      });
    }
  });

  it('falls back to OpenH264 when the build lacks the hardware encoder, saying so', () => {
    const choice = selectEncoder('h264', LGPL_PLAIN, { platform: 'darwin' });
    expect(choice.ok && choice.value).toEqual({
      codec: 'h264',
      encoder: 'libopenh264',
      backend: 'software',
      fallbackReason: { code: 'encoder_missing', detail: 'h264_videotoolbox is not in this FFmpeg build' },
    });
  });

  it('falls back when the hardware encoder failed, carrying the failure', () => {
    const failed = { h264_videotoolbox: 'cannot create compression session' };
    const choice = selectEncoder('h264', LGPL_MAC, { platform: 'darwin', failed });
    expect(choice.ok && choice.value).toMatchObject({
      encoder: 'h264_videotoolbox_software',
      backend: 'software',
      fallbackReason: {
        code: 'hardware_failed',
        detail: 'h264_videotoolbox: cannot create compression session',
      },
    });
  });

  it('records why on a platform with no hardware backend yet, and when software is requested', () => {
    // FreeBSD: no row in the table (Linux has CUDA since LNX1).
    const bsd = selectEncoder('h264', LGPL_PLAIN, { platform: 'freebsd' });
    expect(bsd.ok && bsd.value.fallbackReason?.code).toBe('no_hardware_backend');
    const asked = selectEncoder('h264', LGPL_MAC, { platform: 'darwin', software: true });
    expect(asked.ok && asked.value).toMatchObject({
      encoder: 'h264_videotoolbox_software',
      fallbackReason: { code: 'requested' },
    });
  });

  it('never falls back to a GPL encoder: x264 and x265 do not count', () => {
    const h264 = selectEncoder(
      'h264',
      HOMEBREW.filter((entry) => !entry.hardware),
      { platform: 'darwin' },
    );
    expect(!h264.ok && h264.error).toMatchObject({ code: 'media.no_encoder', params: { codec: 'h264' } });
    expect(!h264.ok && h264.error.detail).toContain('encoder_missing: h264_videotoolbox');
    const hevc = selectEncoder('hevc', LGPL_PLAIN, { platform: 'darwin' });
    expect(!hevc.ok && hevc.error.detail).toMatch(/encoder_missing[\s\S]*software fallback: none allowed/);
  });

  it('uses ProRes in software only when VideoToolbox cannot', () => {
    const choice = selectEncoder('prores', LGPL_PLAIN, { platform: 'darwin' });
    expect(choice.ok && [choice.value.encoder, choice.value.backend]).toEqual(['prores_ks', 'software']);
  });
});

describe('videoToolboxSurfaceFormat', () => {
  // Checked against FFmpeg 9.0.1 on Apple silicon: hwdownload accepts exactly these.
  it.each([
    ['yuv420p', 'nv12'],
    ['yuvj420p', 'nv12'],
    ['yuv420p10le', 'p010le'],
    ['yuv422p', 'nv16'],
    ['yuv422p10le', 'p210le'],
    ['yuv444p', 'nv24'],
    ['yuv444p10le', 'p410le'],
    ['yuv444p12le', 'p416le'],
    ['yuv420p12le', 'p216le'],
    ['yuva444p12le', 'ayuv64le'],
    ['yuva420p', 'ayuv'],
    ['gbrp10le', 'p410le'],
  ])('%s → %s', (pixelFormat, surface) => {
    expect(videoToolboxSurfaceFormat(pixelFormat)).toBe(surface);
  });

  it('has no answer for packed or unknown formats', () => {
    for (const format of ['rgb24', 'yuyv422', 'v210', 'pal8', 'made_up', undefined]) {
      expect(videoToolboxSurfaceFormat(format)).toBeUndefined();
    }
  });
});

describe('planDecode', () => {
  const darwin = { platform: 'darwin' } as const;

  it('decodes H.264, HEVC Main10 and ProRes on VideoToolbox', () => {
    expect(planDecode(videoStream(), darwin)).toEqual({ backend: 'videotoolbox', surfaceFormat: 'nv12' });
    const hevc = videoStream({ codec: 'hevc', pixelFormat: 'yuv420p10le' });
    expect(planDecode(hevc, darwin)).toEqual({ backend: 'videotoolbox', surfaceFormat: 'p010le' });
    const prores = videoStream({ codec: 'prores', pixelFormat: 'yuv422p10le' });
    expect(planDecode(prores, darwin)).toEqual({ backend: 'videotoolbox', surfaceFormat: 'p210le' });
  });

  it.each([
    [{ codec: 'vp8' }, darwin, 'codec_unsupported', 'VideoToolbox has no vp8 decoder'],
    [
      { codec: 'mjpeg', pixelFormat: 'yuvj420p' },
      darwin,
      'codec_unsupported',
      'VideoToolbox has no mjpeg decoder',
    ],
    [{ pixelFormat: 'rgb24' }, darwin, 'format_unsupported', "VideoToolbox can't carry rgb24"],
    [{}, { platform: 'freebsd' }, 'no_hardware_backend', 'no hardware decoder wired up for freebsd yet'],
    [{}, { ...darwin, decode: 'software' }, 'requested', 'software decode requested'],
  ] as const)('software with a reason: %j %j → %s', (stream, options, code, detail) => {
    expect(planDecode(videoStream(stream), options)).toEqual({
      backend: 'software',
      fallbackReason: { code, detail },
    });
  });

  it('remembers a runtime failure for the same codec, profile and pixel format only', () => {
    const failures = new HardwareFailures();
    const hevc12 = videoStream({ codec: 'hevc', profile: 'Main 12', pixelFormat: 'yuv420p12le' });
    failures.remember(hevc12, { code: 'hardware_failed', detail: 'hwaccel initialisation returned error' });
    expect(planDecode(hevc12, { ...darwin, failures })).toEqual({
      backend: 'software',
      fallbackReason: {
        code: 'hardware_failed',
        detail: 'failed earlier for this format: hwaccel initialisation returned error',
      },
    });
    const main10 = videoStream({ codec: 'hevc', profile: 'Main 10', pixelFormat: 'yuv420p10le' });
    expect(planDecode(main10, { ...darwin, failures }).backend).toBe('videotoolbox');
  });
});

describe('fitWithin', () => {
  it('matches scale=min(m,iw):min(m,ih):force_original_aspect_ratio=decrease', () => {
    expect(fitWithin(320, 240, 64)).toEqual({ width: 64, height: 48 });
    expect(fitWithin(320, 240, 100)).toEqual({ width: 100, height: 75 });
    expect(fitWithin(240, 320, 160)).toEqual({ width: 120, height: 160 });
    expect(fitWithin(240, 320, 4096)).toEqual({ width: 240, height: 320 });
    expect(fitWithin(3840, 2160, 768)).toEqual({ width: 768, height: 432 });
    expect(fitWithin(1000, 2, 10)).toEqual({ width: 10, height: 1 });
  });
});
