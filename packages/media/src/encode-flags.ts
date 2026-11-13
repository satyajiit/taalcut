// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Video encode flags for the proxy, the full-quality conform and render's exports: the encoder's row decides
 * (hw-video/rows/*: VideoToolbox's flags as before the table, NVENC's by purpose), and the CPU encoders get the
 * same rate, GOP and colour. Software VideoToolbox is an explicit CPU route on macOS (`-require_sw 1`),
 * never an implicit `-allow_sw` downgrade. AV1's CPU encoder, SVT-AV1, runs only when a hardware export fails.
 */
import type { BackendChoice, DecodePlan } from './backends';
import { bitrateFlags, colourBitstreamFilter, hdrColour, peakFlags, SDR_COLOR } from './hw-video/colour';
import { backendOfEncoder } from './hw-video/table';
import type { EncodeFlagInput, EncodePurpose, HdrTransfer } from './hw-video/types';
import { ffmpegEncoderName, SOFTWARE_VIDEOTOOLBOX_H264 } from './software-encoders';

export { SDR_COLOR } from './hw-video/colour';

export interface VideoEncodeOptions {
  /** Default 'conform': the quality preset with a closed GOP and no B-frames. */
  readonly purpose?: EncodePurpose;
  /** Frames arrive on the encoder's device (`FilterGraph.deviceFrames`): no `-pix_fmt` or colour options. */
  readonly deviceFrames?: boolean;
  /** A 10-bit HDR export (HEVC Main10 or AV1 Main 10-bit where the encoder has it). */
  readonly hdr?: HdrTransfer;
}

/**
 * SVT-AV1's speed preset and constant-rate factor (0–63, lower is better), measured on the RTX 4090 host's CPU
 * (media SPEC "AV1"): preset 8 at CRF 20 is the nearest to NVENC AV1's export quality (VMAF 0.2–1.5 under it at a
 * third to two thirds of the bits) at 30–80 frames a second; preset 10 lost another 0.5–2 VMAF for a third less time.
 */
export const SVT_AV1 = { preset: 8, crf: 20 } as const;

/**
 * SVT-AV1 (`libsvtav1`), AV1's CPU encoder: capped CRF (the CRF under the export's bitrate ceiling, `-maxrate` and
 * `-bufsize`; SVT-AV1 takes no average with a CRF), the GOP, its own hierarchical B-frames, 8-bit BT.709 or 10-bit
 * BT.2020 HLG/PQ, and the colour in the sequence header through `av1_metadata`.
 */
function svtAv1Flags({ videoBps, gop, hdr }: EncodeFlagInput): string[] {
  return [
    '-preset',
    String(SVT_AV1.preset),
    '-crf',
    String(SVT_AV1.crf),
    ...peakFlags(videoBps),
    '-g',
    String(Math.max(1, gop)),
    '-pix_fmt',
    hdr ? 'yuv420p10le' : 'yuv420p',
    ...(hdr ? hdrColour(hdr) : SDR_COLOR),
    '-bsf:v',
    colourBitstreamFilter('av1', hdr),
  ];
}

/**
 * CPU encoders (libopenh264, prores_ks): closed GOP, no B-frames, BT.709; OpenH264's VUI through the filter. An
 * OpenH264 export is H.264 High, as the hardware rows' are (OpenH264 writes Constrained Baseline unless asked).
 */
function softwareFlags(input: EncodeFlagInput): string[] {
  const { encoder, purpose, videoBps, gop } = input;
  if (encoder === 'libsvtav1') return svtAv1Flags(input);
  const flags = [
    ...bitrateFlags(videoBps),
    '-bf',
    '0',
    '-g',
    String(Math.max(1, gop)),
    '-pix_fmt',
    'yuv420p',
    ...SDR_COLOR,
  ];
  if (encoder === 'libopenh264' && purpose === 'export') flags.push('-profile:v', 'high');
  if (encoder === 'libopenh264') flags.push('-bsf:v', colourBitstreamFilter('h264'));
  return flags;
}

/** The mux delays the 0 ms drift measurement needs, and faststart. */
const MUX = [
  '-video_track_timescale',
  '90000',
  '-movflags',
  '+faststart',
  '-muxdelay',
  '0',
  '-muxpreload',
  '0',
];

/** `-c:v <encoder>`, its row's flags for `options.purpose`, then the mux flags. */
export function videoEncodeFlags(
  encoder: string,
  videoBps: number,
  gop: number,
  options: VideoEncodeOptions = {},
): string[] {
  const resolvedEncoder = ffmpegEncoderName(encoder);
  const input: EncodeFlagInput = {
    encoder: resolvedEncoder,
    purpose: options.purpose ?? 'conform',
    videoBps,
    gop,
    ...(options.deviceFrames ? { deviceFrames: true } : {}),
    ...(options.hdr ? { hdr: options.hdr } : {}),
  };
  const row = backendOfEncoder(resolvedEncoder)?.encode;
  const cpu = encoder === SOFTWARE_VIDEOTOOLBOX_H264 ? ['-require_sw', '1'] : [];
  return ['-c:v', resolvedEncoder, ...cpu, ...(row ? row.flags(input) : softwareFlags(input)), ...MUX];
}

export function progressBackend(route: DecodePlan): BackendChoice {
  if (route.backend !== 'software') return { backend: route.backend };
  return { backend: 'software', fallbackReason: route.fallbackReason };
}
