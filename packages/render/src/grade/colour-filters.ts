// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * BT.709 limited-range YUV ↔ full-range R′G′B′ through zscale (zimg), with every property named so an untagged
 * file converts the same way. zscale, not swscale: swscale's RGB output paths land 1–2 code values off the
 * BT.709 matrix (measured on this build), which a non-linear cube turns into a colour error; zscale is exact
 * and its round trip is bit-identical.
 */
export function bt709ToRgbFilter(range: 'limited' | 'full' = 'limited'): string {
  return `zscale=matrixin=709:transferin=709:primariesin=709:rangein=${range}:matrix=gbr:transfer=709:primaries=709:range=full,format=gbrp16le`;
}

export const RGB_TO_BT709_FILTER =
  'zscale=matrixin=gbr:transferin=709:primariesin=709:rangein=full:matrix=709:transfer=709:primaries=709:range=limited,format=yuv420p';
