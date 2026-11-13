// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { FrameRate } from '@taalcut/core';

/** H.264 Annex A: 5.1 permits 983040 macroblocks/s; 5.2 permits 2073600 and 36864 per frame. */
export function h264NeedsLevel52(width: number, height: number, rate: FrameRate): boolean {
  const blocks = Math.ceil(width / 16) * Math.ceil(height / 16);
  return blocks * rate.num > 983_040 * rate.den;
}

/** VideoToolbox's automatic level can under-declare 4K60. Ask the encoder for its actual required level. */
export function h264LevelFlags(encoder: string, width: number, height: number, rate: FrameRate): string[] {
  const blocks = Math.ceil(width / 16) * Math.ceil(height / 16);
  return encoder === 'h264_videotoolbox' &&
    h264NeedsLevel52(width, height, rate) &&
    blocks <= 36_864 &&
    blocks * rate.num <= 2_073_600 * rate.den
    ? ['-level:v', '5.2']
    : [];
}
