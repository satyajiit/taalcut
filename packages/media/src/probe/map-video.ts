// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Video-specific probe mapping: rotation from the display matrix, HDR
 * detection (HLG, PQ, Dolby Vision), bit depth and exact frame rates.
 */
import { parseRational, rationalEquals, type Rational } from '../rational';
import { pixelFormatBitDepth } from './pixel-formats';
import type { FfprobeSideData, FfprobeStream } from './schema';
import type { DolbyVisionInfo, HdrFormat, VideoStreamInfo } from './types';

const ROTATIONS = [0, 90, 180, 270] as const;

function sideData(stream: FfprobeStream, type: RegExp): FfprobeSideData | undefined {
  return stream.side_data_list?.find((entry) => type.test(entry.side_data_type));
}

/**
 * Clockwise degrees to rotate the coded frame for display. ffprobe's display
 * matrix `rotation` is counter-clockwise (an iPhone portrait clip reads -90);
 * the legacy `rotate` tag is already clockwise.
 */
export function rotationOf(stream: FfprobeStream): VideoStreamInfo['rotation'] {
  const matrix = sideData(stream, /^display matrix$/i);
  let clockwise: number | undefined;
  if (matrix?.rotation !== undefined) clockwise = -matrix.rotation;
  else if (stream.tags?.rotate && /^-?\d+(\.\d+)?$/.test(stream.tags.rotate))
    clockwise = Number(stream.tags.rotate);
  if (clockwise === undefined || !Number.isFinite(clockwise)) return 0;
  const quarter = ((Math.round(clockwise / 90) % 4) + 4) % 4;
  return ROTATIONS[quarter] ?? 0;
}

/**
 * A display matrix whose upper 2×2 has a negative determinant is a mirror
 * (some front cameras). ffprobe prints the matrix as 16.16 fixed-point rows.
 */
export function mirroredOf(stream: FfprobeStream): boolean {
  const text = sideData(stream, /^display matrix$/i)?.displaymatrix;
  if (!text) return false;
  const rows: number[][] = [];
  for (const line of text.split('\n')) {
    const nums = line
      .trim()
      .split(/\s+/)
      .filter((part) => /^-?\d+$/.test(part))
      .map(Number);
    if (nums.length >= 3) rows.push(nums.slice(-3));
  }
  const top = rows[0];
  const next = rows[1];
  if (!top || !next) return false;
  const a = top[0] ?? 0;
  const b = top[1] ?? 0;
  const c = next[0] ?? 0;
  const d = next[1] ?? 0;
  return a * d - b * c < 0;
}

export function dolbyVisionOf(stream: FfprobeStream): DolbyVisionInfo | undefined {
  const dovi = sideData(stream, /dovi|dolby vision/i);
  if (!dovi || dovi.dv_profile === undefined) return undefined;
  const flag = (value: number | undefined) => (value === undefined ? undefined : value === 1);
  return {
    profile: dovi.dv_profile,
    level: dovi.dv_level,
    compatibilityId: dovi.dv_bl_signal_compatibility_id,
    rpuPresent: flag(dovi.rpu_present_flag),
    enhancementLayerPresent: flag(dovi.el_present_flag),
    baseLayerPresent: flag(dovi.bl_present_flag),
  };
}

export function hdrFormatsOf(
  transfer: string | undefined,
  dolbyVision: DolbyVisionInfo | undefined,
): HdrFormat[] {
  const formats: HdrFormat[] = [];
  if (transfer === 'arib-std-b67') formats.push('hlg');
  if (transfer === 'smpte2084') formats.push('pq');
  if (dolbyVision) formats.push('dolby_vision');
  return formats;
}

/** Bits per component: ffprobe's bits_per_raw_sample when set, else read from the pixel format name. */
export function bitDepthOf(
  pixelFormat: string | undefined,
  bitsPerRawSample: string | undefined,
): number | undefined {
  const raw = bitsPerRawSample ? Number(bitsPerRawSample) : 0;
  if (raw > 0) return raw;
  return pixelFormat ? pixelFormatBitDepth(pixelFormat) : undefined;
}

/** A frame rate, or undefined for ffprobe's '0/0' and other non-rates. */
export function frameRateOf(text: string | undefined): Rational | undefined {
  const rate = parseRational(text);
  return rate && rate.num > 0 ? rate : undefined;
}

/**
 * True when r_frame_rate and avg_frame_rate differ at all. Strict on purpose:
 * 30/1 against 17985/600 is only 0.08% apart but drifts 1.5 frames a minute,
 * which is enough to pull cuts off the beat (PRD G2). A false positive only
 * costs a constant-frame-rate pass that phone footage gets anyway.
 */
export function vfrHintOf(frameRate: Rational | undefined, averageFrameRate: Rational | undefined): boolean {
  if (!frameRate || !averageFrameRate) return false;
  return !rationalEquals(frameRate, averageFrameRate);
}
