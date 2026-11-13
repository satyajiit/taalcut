// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * VideoToolbox (every Mac). Frames stay on the GPU (`videotoolbox_vld`), turned with `transpose_vt` and scaled
 * with `scale_vt`, then downloaded; 10-bit and HDR frames download as P010 (a yuv420p download of them exits
 * 234). The encoders take system frames: the flags are the ones media used before the table, byte for byte.
 * VideoToolbox has no AV1 encoder (Apple silicon decodes AV1 from M3 on, and encodes none), so a Mac exports no AV1.
 */
import { bitrateFlags, colourBitstreamFilter, hdrColour, SDR_COLOR } from '../colour';
import { videoToolboxSurfaceFormat } from '../surface';
import type { EncodeFlagInput, HwVideoBackend } from '../types';

/**
 * Codecs FFmpeg can hand to VideoToolbox. Whether this Mac decodes them is only known by trying: AV1 needs an M3
 * or later, MPEG-2 and MPEG-4 Part 2 fail on Apple silicon, HEVC 12-bit fails. Those failures fall back at run time.
 */
const DECODES = new Set([
  'av1',
  'h263',
  'h264',
  'hevc',
  'mpeg1video',
  'mpeg2video',
  'mpeg4',
  'prores',
  'vp9',
]);

function flags({ encoder, videoBps, gop, hdr }: EncodeFlagInput): string[] {
  const hevc = encoder === 'hevc_videotoolbox';
  const ten = hdr !== undefined && hevc;
  const out = [
    ...bitrateFlags(videoBps),
    '-bf',
    '0',
    '-g',
    String(Math.max(1, gop)),
    '-pix_fmt',
    ten ? 'p010le' : 'yuv420p',
    ...(ten ? hdrColour(hdr) : SDR_COLOR),
  ];
  if (encoder === 'h264_videotoolbox') out.push('-profile:v', 'high');
  if (ten) out.push('-profile:v', 'main10');
  if (hevc) out.push('-tag:v', 'hvc1');
  if (encoder === 'h264_videotoolbox') out.push('-bsf:v', colourBitstreamFilter('h264'));
  return out;
}

export const videoToolboxBackend: HwVideoBackend = {
  id: 'videotoolbox',
  compute: { decode: 'videotoolbox', encode: 'videotoolbox' },
  verified: true,
  decode: {
    label: 'VideoToolbox',
    hwaccel: 'videotoolbox',
    outputFormat: 'videotoolbox_vld',
    codecs: DECODES,
    stills: true,
    surfaceFormat: (video) => videoToolboxSurfaceFormat(video.pixelFormat),
    downloadFormat: (surface, deep) => (deep ? 'p010le' : surface),
    transpose: 'transpose_vt',
    scale: (width, height) => `scale_vt=w=${width}:h=${height}`,
    // Measured (IX2-T1): 30 of 1,800 frames decoded from a 4K HEVC clip with one keyframe a second.
    honoursSkipFrame: true,
  },
  encode: {
    encoders: { h264: 'h264_videotoolbox', hevc: 'hevc_videotoolbox', prores: 'prores_videotoolbox' },
    // VideoToolbox encoders could take videotoolbox_vld frames too; the Mac keeps its measured download route.
    takesDeviceFrames: false,
    flags,
  },
};
