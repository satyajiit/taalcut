// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * NVIDIA: NVDEC decode through `-hwaccel cuda` (FFmpeg's own decoders, so `-skip_frame nokey` works), turned and
 * scaled on the GPU with `transpose_cuda` and `scale_cuda` (FFmpeg's CUDA filters, built with `--enable-cuda-llvm`,
 * LGPL; `scale_npp` needs nonfree libnpp and is never used), and NVENC, which takes those CUDA frames directly:
 * a graph with no CPU filter never downloads (zero copy). `hwdownload` names the frames' own format (NV12, P010,
 * P016, YUV444P[16]); CUDA can't convert on the way down. Measured on an RTX 4090, driver 615.71, BtbN n9.0.2.
 * AV1 encode (`av1_nvenc`) needs Ada (RTX 40) or newer: on older cards the encoder is compiled in and its trial
 * encode fails, which is how a machine says it has no hardware AV1 (LNX1-AV1; not run on an RTX 30 here).
 */
import { bitrateFlags, codecOf, colourBitstreamFilter, hdrColour, SDR_COLOR } from '../colour';
import { cudaSurfaceFormat } from '../surface';
import type { EncodeFlagInput, HwVideoBackend } from '../types';

/** libavcodec's NVDEC hwaccels. AV1 needs Ampere or later; the rest Turing (the tuned floor, sm_75). */
const DECODES = new Set(['av1', 'h264', 'hevc', 'mpeg1video', 'mpeg2video', 'mpeg4', 'vc1', 'vp8', 'vp9']);

type NvencCodec = 'h264' | 'hevc' | 'av1';

/**
 * NVENC's constant-quality target for the quality presets (lower is better; HEVC and AV1 need fewer bits for the
 * same). AV1's scale is its own (0–63): its export at CQ 25 with the `uhq` tune matched HEVC's CQ 21 on VMAF under
 * the same bitrate ladder with fewer bits (LNX1-AV1, measured on the RTX 4090; media SPEC, "AV1").
 */
const QUALITY: Readonly<Record<NvencCodec, number>> = { h264: 19, hevc: 21, av1: 25 };

/**
 * An export's tune and B-frames: `hq` with three; AV1 `uhq` (Ada's lookahead-driven tune, which NVENC opens only
 * with four B-frames, measured) with four. Both use B-frames as references (`middle`).
 */
const EXPORT_SHAPE: Readonly<Record<NvencCodec, { readonly tune: string; readonly bframes: number }>> = {
  h264: { tune: 'hq', bframes: 3 },
  hevc: { tune: 'hq', bframes: 3 },
  av1: { tune: 'uhq', bframes: 4 },
};

/** The profile NVENC is asked for: H.264 High, HEVC Main or Main10. AV1 has no option: NVENC writes Main. */
function profileFlags(codec: NvencCodec, ten: boolean): string[] {
  if (codec === 'av1') return [];
  return ['-profile:v', codec === 'h264' ? 'high' : ten ? 'main10' : 'main'];
}

/**
 * NVENC flags by purpose. Proxies: preset p2 with the low-latency tune, closed GOP (NVENC starts every GOP with an
 * IDR), no B-frames. Conform: preset p5, `hq` tune, VBR with a quality target under the bitrate ceiling, spatial and
 * temporal AQ with a 20-frame lookahead, still no B-frames (the drift measurement needs no reorder delay). Export:
 * conform's plus B-frames used as references (EXPORT_SHAPE; AV1 on `uhq`). Colour as VideoToolbox: BT.709 tags, and the VUI
 * (AV1: the sequence header's colour config) written by the bitstream filter; HDR exports are HEVC Main10 or AV1
 * Main 10-bit from P010 with BT.2020 and HLG or PQ.
 */
export function nvencFlags({
  encoder,
  purpose,
  videoBps,
  gop,
  deviceFrames,
  hdr,
}: EncodeFlagInput): string[] {
  const codec = codecOf(encoder) ?? 'h264';
  const ten = hdr !== undefined && codec !== 'h264';
  const quality = purpose !== 'proxy';
  const shape = EXPORT_SHAPE[codec];
  const exporting = purpose === 'export';
  const out = [
    '-preset',
    quality ? 'p5' : 'p2',
    '-tune',
    exporting ? shape.tune : quality ? 'hq' : 'll',
    '-rc',
    'vbr',
    ...(quality ? ['-cq', String(QUALITY[codec])] : []),
    ...bitrateFlags(videoBps),
    ...(quality ? ['-spatial-aq', '1', '-temporal-aq', '1', '-rc-lookahead', '20'] : []),
    ...(exporting ? ['-bf', String(shape.bframes), '-b_ref_mode', 'middle'] : ['-bf', '0']),
    '-g',
    String(Math.max(1, gop)),
  ];
  // CUDA frames carry their own format and colour; a -pix_fmt or colour option would put a CPU filter in front.
  if (!deviceFrames) out.push('-pix_fmt', ten ? 'p010le' : 'yuv420p', ...(ten ? hdrColour(hdr) : SDR_COLOR));
  out.push(...profileFlags(codec, ten));
  if (codec === 'hevc') out.push('-tag:v', 'hvc1');
  out.push('-bsf:v', colourBitstreamFilter(codec, ten ? hdr : undefined));
  return out;
}

export const cudaBackend: HwVideoBackend = {
  id: 'cuda',
  compute: { decode: 'cuda', encode: 'nvenc' },
  verified: true,
  decode: {
    label: 'NVDEC',
    hwaccel: 'cuda',
    outputFormat: 'cuda',
    codecs: DECODES,
    stills: false,
    surfaceFormat: (video) => cudaSurfaceFormat(video.codec, video.pixelFormat),
    downloadFormat: (surface) => surface,
    transpose: 'transpose_cuda',
    // Bicubic, like the CPU route's scale (scale_cuda's default is bilinear).
    scale: (width, height) => `scale_cuda=w=${width}:h=${height}:interp_algo=bicubic`,
    honoursSkipFrame: true,
  },
  encode: {
    encoders: { h264: 'h264_nvenc', hevc: 'hevc_nvenc', av1: 'av1_nvenc' },
    takesDeviceFrames: true,
    // Measured on the RTX 4090 (driver 615.71): below these NVENC says "Frame Dimension less than the minimum
    // supported value" (h264 145×120 and 146×49 fail; hevc 129×64 and 160×33 fail; av1 129×66 and 160×65 fail).
    minimumSize: {
      h264: { width: 146, height: 50 },
      hevc: { width: 130, height: 34 },
      av1: { width: 130, height: 66 },
    },
    flags: nvencFlags,
  },
  // Upload, scale, turn and download through CUDA: proves the driver, the device (CUDA_VISIBLE_DEVICES) and the
  // CUDA filters' kernels. The first run on a machine JIT-compiles them (about 3 s), cached in CUDA_CACHE_PATH.
  deviceTrial: [
    '-init_hw_device',
    'cuda=taalcut',
    '-filter_hw_device',
    'taalcut',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=64x64:rate=30',
    '-frames:v',
    '2',
    '-vf',
    'format=nv12,hwupload,scale_cuda=w=32:h=32,transpose_cuda=dir=clock,hwdownload,format=nv12',
    '-f',
    'null',
    '-',
  ],
};
