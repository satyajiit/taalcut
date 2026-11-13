// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Bits per component from an FFmpeg pixel format name, for streams where
 * ffprobe gives no bits_per_raw_sample. Names are matched without their
 * le/be suffix. Packed and semi-planar formats come from a table, because
 * their digits are a layout code, not the depth (v210 and p210 are 10-bit,
 * p216 and p416 16-bit). Planar formats carry the depth after the plane
 * layout (yuv420p10, gbrp12, gray16). Anything else is unknown, not 8.
 */

const PACKED: Readonly<Record<string, number>> = {
  // 10-bit: VideoToolbox and ProRes outputs, 10-bit 4:2:2 capture.
  p010: 10,
  p210: 10,
  p410: 10,
  nv20: 10,
  v210: 10,
  v410: 10,
  v30x: 10,
  xv30: 10,
  y210: 10,
  x2rgb10: 10,
  x2bgr10: 10,
  // 12-bit.
  p012: 12,
  p212: 12,
  p412: 12,
  xv36: 12,
  y212: 12,
  // 16-bit.
  p016: 16,
  p216: 16,
  p416: 16,
  xv48: 16,
  y216: 16,
  ayuv64: 16,
  rgb48: 16,
  bgr48: 16,
  rgba64: 16,
  bgra64: 16,
};

const PLANAR = /^(?:yuva?\d{3}p|yuvj\d{3}p|gbra?p|gray|ya)(9|10|12|14|16)$/;

const EIGHT_BIT = new Set([
  'yuv420p',
  'yuvj420p',
  'yuv422p',
  'yuvj422p',
  'yuv444p',
  'yuvj444p',
  'yuv440p',
  'yuvj440p',
  'yuv411p',
  'yuvj411p',
  'yuv410p',
  'yuva420p',
  'yuva422p',
  'yuva444p',
  'nv12',
  'nv21',
  'nv16',
  'nv24',
  'nv42',
  'uyvy422',
  'yuyv422',
  'yvyu422',
  'rgb24',
  'bgr24',
  'rgba',
  'bgra',
  'argb',
  'abgr',
  'rgb0',
  'bgr0',
  '0rgb',
  '0bgr',
  'gray',
  'ya8',
  'gbrp',
  'gbrap',
  'pal8',
  'ayuv',
  'vuya',
  'vuyx',
  'uyva',
]);

export function pixelFormatBitDepth(pixelFormat: string): number | undefined {
  const base = pixelFormat.replace(/(le|be)$/, '');
  const packed = PACKED[base];
  if (packed !== undefined) return packed;
  const planar = PLANAR.exec(base);
  if (planar) return Number(planar[1]);
  return EIGHT_BIT.has(base) ? 8 : undefined;
}
