// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Colour tags and rate control every encoder row shares. Hardware encoders and libopenh264 drop the container's
 * colour options or never write them into the bitstream's VUI (NVENC, measured: transfer and primaries came out
 * `unknown`), so a bitstream filter writes them where ffprobe and players read them: the VUI for H.264 and HEVC,
 * the sequence header's colour config for AV1.
 */
import type { HdrTransfer } from './types';

/** BT.709, limited range: what every SDR output is. */
export const SDR_COLOR = [
  '-color_primaries',
  'bt709',
  '-color_trc',
  'bt709',
  '-colorspace',
  'bt709',
  '-color_range',
  'tv',
];

/** BT.2020 with HLG or PQ, limited range. */
export function hdrColour(transfer: HdrTransfer): string[] {
  const trc = transfer === 'hlg' ? 'arib-std-b67' : 'smpte2084';
  return ['-color_primaries', 'bt2020', '-color_trc', trc, '-colorspace', 'bt2020nc', '-color_range', 'tv'];
}

/** The codecs a colour bitstream filter exists for. */
export type TaggedCodec = 'h264' | 'hevc' | 'av1';

/**
 * The `h264_metadata` / `hevc_metadata` / `av1_metadata` bitstream filter that writes the colour description (the
 * VUI of H.264 and HEVC, AV1's sequence header colour config).
 */
export function colourBitstreamFilter(codec: TaggedCodec, hdr?: HdrTransfer): string {
  // H.273 code points: BT.709 = 1; BT.2020 primaries and non-constant matrix = 9; HLG = 18, PQ = 16.
  const [primaries, transfer, matrix] = hdr ? [9, hdr === 'hlg' ? 18 : 16, 9] : [1, 1, 1];
  // av1_metadata names the primaries and the range its own way (AV1 spec 6.4.2); the code points are the same.
  if (codec === 'av1')
    return (
      `av1_metadata=color_primaries=${primaries}:transfer_characteristics=${transfer}` +
      `:matrix_coefficients=${matrix}:color_range=tv`
    );
  return (
    `${codec}_metadata=colour_primaries=${primaries}:transfer_characteristics=${transfer}` +
    `:matrix_coefficients=${matrix}:video_full_range_flag=0`
  );
}

/** Average, peak and buffer: `-maxrate` 1.5× and `-bufsize` 2× the average. */
export function bitrateFlags(videoBps: number): string[] {
  return ['-b:v', String(Math.max(1, Math.round(videoBps))), ...peakFlags(videoBps)];
}

/** The peak and buffer alone, for an encoder whose quality target replaces the average (SVT-AV1's capped CRF). */
export function peakFlags(videoBps: number): string[] {
  const bps = Math.max(1, Math.round(videoBps));
  return ['-maxrate', String(Math.round(bps * 1.5)), '-bufsize', String(bps * 2)];
}

/** The codec an encoder name produces ('hevc_nvenc' → 'hevc', 'libsvtav1' → 'av1'). */
export function codecOf(encoder: string): TaggedCodec | undefined {
  if (/^(h264|libopenh264)/.test(encoder)) return 'h264';
  if (/^hevc/.test(encoder)) return 'hevc';
  if (/^(av1|libsvtav1|libaom-av1|librav1e)/.test(encoder)) return 'av1';
  return undefined;
}
