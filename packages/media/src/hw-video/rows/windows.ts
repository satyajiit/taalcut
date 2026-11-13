// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Windows slots: typed rows, unit-tested on their arguments, never selected this round (nothing runs on Windows
 * yet). core names no D3D11VA or Media Foundation compute backend; their rows report `directml`, the DirectX
 * family, until a contract adds the names with the Windows port. AV1 encoders (LNX1-AV1) are typed entries: Intel Arc
 * (`av1_qsv`) and AMD RDNA3 (`av1_amf`) have them, and Media Foundation lists whatever the GPU's vendor registered.
 */
import { bitrateFlags, codecOf, colourBitstreamFilter, SDR_COLOR } from '../colour';
import { d3d11vaSurfaceFormat, vaapiSurfaceFormat } from '../surface';
import type { EncodeFlagInput, HwVideoBackend } from '../types';

/** System-frame flags every slot encoder accepts: rate, closed GOP, BT.709 and the colour filter (AV1's own). */
function systemFrameFlags({ encoder, videoBps, gop }: EncodeFlagInput): string[] {
  const codec = codecOf(encoder) ?? 'h264';
  return [
    ...bitrateFlags(videoBps),
    '-bf',
    '0',
    '-g',
    String(Math.max(1, gop)),
    '-pix_fmt',
    'nv12',
    ...SDR_COLOR,
    ...(codec === 'hevc' ? ['-tag:v', 'hvc1'] : []),
    '-bsf:v',
    colourBitstreamFilter(codec),
  ];
}

const WINDOWS_DECODES = new Set(['av1', 'h264', 'hevc', 'mpeg2video', 'vc1', 'vp9']);

/**
 * D3D11VA: decode on any DirectX 11 GPU. FFmpeg has no D3D11 scale or transpose filter, so frames download at once
 * and turn and scale on the CPU (decode-routes/d3d11va.ts, IX2-T4).
 */
export const d3d11vaBackend: HwVideoBackend = {
  id: 'd3d11va',
  compute: { decode: 'directml', encode: 'directml' },
  verified: false,
  decode: {
    label: 'D3D11VA',
    hwaccel: 'd3d11va',
    outputFormat: 'd3d11',
    codecs: WINDOWS_DECODES,
    stills: false,
    surfaceFormat: (video) => d3d11vaSurfaceFormat(video.pixelFormat),
    downloadFormat: (surface) => surface,
    honoursSkipFrame: true,
  },
};

/** Intel Quick Sync: QSV decode with its VPP scale, and the QSV encoders. */
export const qsvBackend: HwVideoBackend = {
  id: 'qsv',
  compute: { decode: 'qsv', encode: 'qsv' },
  verified: false,
  decode: {
    label: 'Quick Sync',
    hwaccel: 'qsv',
    outputFormat: 'qsv',
    codecs: WINDOWS_DECODES,
    stills: false,
    surfaceFormat: (video) => vaapiSurfaceFormat(video.pixelFormat),
    downloadFormat: (surface) => surface,
    scale: (width, height) => `scale_qsv=w=${width}:h=${height}`,
    honoursSkipFrame: true,
  },
  encode: {
    encoders: { h264: 'h264_qsv', hevc: 'hevc_qsv', av1: 'av1_qsv' },
    takesDeviceFrames: true,
    flags: (input) => [
      '-preset',
      input.purpose === 'proxy' ? 'veryfast' : 'slow',
      ...systemFrameFlags(input),
    ],
  },
};

/** AMD AMF encoders (decode is D3D11VA on AMD). */
export const amfBackend: HwVideoBackend = {
  id: 'amf',
  compute: { decode: 'amf', encode: 'amf' },
  verified: false,
  encode: {
    encoders: { h264: 'h264_amf', hevc: 'hevc_amf', av1: 'av1_amf' },
    takesDeviceFrames: false,
    flags: (input) => [
      '-quality',
      input.purpose === 'proxy' ? 'speed' : 'quality',
      ...systemFrameFlags(input),
    ],
  },
};

/** Media Foundation's encoder transforms: whatever the GPU vendor registered (NVENC, Quick Sync, AMF). */
export const mfBackend: HwVideoBackend = {
  id: 'mf',
  compute: { decode: 'directml', encode: 'directml' },
  verified: false,
  encode: {
    encoders: { h264: 'h264_mf', hevc: 'hevc_mf', av1: 'av1_mf' },
    takesDeviceFrames: false,
    flags: (input) => ['-hw_encoding', '1', ...systemFrameFlags(input)],
  },
};
