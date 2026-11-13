// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Bit depth from the pixel format name when ffprobe gives no bits_per_raw_sample. */
import { describe, expect, it } from 'vitest';
import { bitDepthOf } from '../src/probe/map-video';

describe('bitDepthOf', () => {
  it.each([
    // Planar and semi-planar 8-bit.
    ['yuv420p', 8],
    ['yuvj420p', 8],
    ['nv12', 8],
    ['uyvy422', 8],
    ['bgra', 8],
    ['rgb24', 8],
    ['gray', 8],
    // Planar high bit depth: the number after 'p' is the depth.
    ['yuv420p10le', 10],
    ['yuv422p10be', 10],
    ['yuv444p12le', 12],
    ['yuva444p16le', 16],
    ['gbrp10le', 10],
    ['gray10le', 10],
    ['yuv420p9le', 9],
    // Packed and semi-planar formats whose digits are not the depth (VideoToolbox, ProRes, pro cameras).
    ['p010le', 10],
    ['p012le', 12],
    ['p016le', 16],
    ['p210le', 10],
    ['p216le', 16],
    ['p410le', 10],
    ['p416le', 16],
    ['v210', 10],
    ['y210le', 10],
    ['xv30le', 10],
    ['x2rgb10le', 10],
    ['rgb48le', 16],
    ['rgba64be', 16],
    ['ayuv64le', 16],
  ] as const)('%s is %i-bit', (format, bits) => {
    expect(bitDepthOf(format, undefined)).toBe(bits);
  });

  it('prefers bits_per_raw_sample and does not guess for unknown formats', () => {
    expect(bitDepthOf('v210', '10')).toBe(10);
    expect(bitDepthOf('yuv420p', '12')).toBe(12);
    expect(bitDepthOf('made_up_fmt', undefined)).toBeUndefined();
    expect(bitDepthOf('gbrpf32le', undefined)).toBeUndefined();
    expect(bitDepthOf(undefined, undefined)).toBeUndefined();
  });
});
