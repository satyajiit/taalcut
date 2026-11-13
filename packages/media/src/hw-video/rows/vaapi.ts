// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * VA-API (Intel and AMD on Linux). Off unless the host's probe names it and its device trial passes. The trial is
 * its own FFmpeg run, so a driver that aborts only fails the trial: BtbN's build, which Linux took until 2026-10-27,
 * aborted on Ubuntu 24.04's libva 2.20 (SIGABRT, exit 134). tools/ffmpeg's build links the system libva, and
 * `verify-linux.sh`'s round trip and `h264_vaapi` encode pass on the host's Intel UHD 770; this row's own trial and
 * media's VA-API suites have not run against it yet, so it stays `verified: false` (media SPEC, "Not done").
 */
import { bitrateFlags, codecOf, colourBitstreamFilter } from '../colour';
import { vaapiSurfaceFormat } from '../surface';
import type { EncodeFlagInput, HwVideoBackend } from '../types';

const DECODES = new Set(['av1', 'h264', 'hevc', 'mpeg2video', 'vc1', 'vp8', 'vp9']);

/** Opens the render node FFmpeg finds first as the filters' device. */
const DEVICE = ['-init_hw_device', 'vaapi=taalcut', '-filter_hw_device', 'taalcut'];
const UPLOAD = ['format=nv12', 'hwupload'];

function flags({ encoder, videoBps, gop, purpose }: EncodeFlagInput): string[] {
  const codec = codecOf(encoder) ?? 'h264';
  return [
    '-rc_mode',
    'VBR',
    ...bitrateFlags(videoBps),
    '-bf',
    purpose === 'export' ? '2' : '0',
    '-g',
    String(Math.max(1, gop)),
    '-profile:v',
    codec === 'h264' ? 'high' : 'main',
    ...(codec === 'hevc' ? ['-tag:v', 'hvc1'] : []),
    '-bsf:v',
    colourBitstreamFilter(codec),
  ];
}

export const vaapiBackend: HwVideoBackend = {
  id: 'vaapi',
  compute: { decode: 'vaapi', encode: 'vaapi' },
  verified: false,
  decode: {
    label: 'VA-API',
    hwaccel: 'vaapi',
    outputFormat: 'vaapi',
    codecs: DECODES,
    stills: false,
    surfaceFormat: (video) => vaapiSurfaceFormat(video.pixelFormat),
    downloadFormat: (surface) => surface,
    transpose: 'transpose_vaapi',
    scale: (width, height) => `scale_vaapi=w=${width}:h=${height}`,
    honoursSkipFrame: true,
  },
  encode: {
    encoders: { h264: 'h264_vaapi', hevc: 'hevc_vaapi' },
    takesDeviceFrames: true,
    upload: { inputArgs: DEVICE, filters: UPLOAD },
    flags,
    trialArgs: (encoder) => [
      ...DEVICE,
      ...['-f', 'lavfi', '-i', 'testsrc2=size=256x144:rate=30', '-frames:v', '10'],
      ...['-vf', UPLOAD.join(','), '-c:v', encoder, '-f', 'null', '-'],
    ],
  },
  deviceTrial: [
    ...DEVICE,
    ...['-f', 'lavfi', '-i', 'testsrc2=size=64x64:rate=30', '-frames:v', '2'],
    ...['-vf', 'format=nv12,hwupload,scale_vaapi=w=32:h=32,hwdownload,format=nv12', '-f', 'null', '-'],
  ],
};
