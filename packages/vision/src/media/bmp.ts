// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * An uncompressed 24-bit BMP for raw frames (IX-O6). The mac helper reads
 * frames from files through ImageIO, which reads BMP as well as PNG. Writing
 * a BMP is a byte copy, where PNG's deflate cost 6–27 ms per 1280 × 720
 * frame idle and 71 ms on a loaded machine (IX-O1). The pixels are the same
 * either way (both are lossless).
 */

const FILE_HEADER = 14;
const INFO_HEADER = 40;

/** Encodes 8-bit rgb24 pixels, row-major, as a bottom-up BI_RGB BMP file's bytes. */
export function encodeBmp(rgb: Uint8Array, width: number, height: number): Buffer {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError(`BMP size must be positive integers, got ${width}x${height}`);
  }
  if (rgb.length < width * height * 3) {
    throw new RangeError(`BMP pixels: need ${width * height * 3} bytes, got ${rgb.length}`);
  }
  // Each row is padded to a multiple of 4 bytes.
  const stride = Math.ceil((width * 3) / 4) * 4;
  const offset = FILE_HEADER + INFO_HEADER;
  const out = Buffer.alloc(offset + stride * height);
  out.write('BM', 0, 'ascii');
  out.writeUInt32LE(out.length, 2);
  out.writeUInt32LE(offset, 10);
  out.writeUInt32LE(INFO_HEADER, 14);
  out.writeInt32LE(width, 18);
  out.writeInt32LE(height, 22); // positive: rows bottom-up
  out.writeUInt16LE(1, 26); // planes
  out.writeUInt16LE(24, 28); // bits per pixel
  out.writeUInt32LE(0, 30); // BI_RGB
  out.writeUInt32LE(stride * height, 34);
  out.writeInt32LE(2835, 38); // 72 dpi
  out.writeInt32LE(2835, 42);
  for (let y = 0; y < height; y++) {
    let src = (height - 1 - y) * width * 3;
    let dst = offset + y * stride;
    for (let x = 0; x < width; x++, src += 3, dst += 3) {
      out[dst] = rgb[src + 2] ?? 0;
      out[dst + 1] = rgb[src + 1] ?? 0;
      out[dst + 2] = rgb[src] ?? 0;
    }
  }
  return out;
}
