// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A minimal PNG encoder for raw frames: the mac helper reads files, not
 * pixels, so frames already decoded for PP-OCR are written once as PNG
 * (lossless, so both engines see the same pixels). Node built-ins only.
 */
import { crc32, deflateSync } from 'node:zlib';

export const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** One PNG chunk: big-endian length, type, data, then the crc32 of type and data. */
export function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([length, body, crc]);
}

/** Encodes 8-bit rgb24 (3 channels) or gray (1 channel) pixels, row-major, as a PNG file's bytes. */
export function encodePng(pixels: Uint8Array, width: number, height: number, channels: 1 | 3 = 3): Buffer {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError(`PNG size must be positive integers, got ${width}x${height}`);
  }
  const stride = width * channels;
  if (pixels.length < stride * height) {
    throw new RangeError(`PNG pixels: need ${stride * height} bytes, got ${pixels.length}`);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = channels === 3 ? 2 : 0;
  // Compression, filter and interlace methods: the only ones PNG defines (0), no interlace.
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    // Filter type 1 (Sub) per row: frames with flat backgrounds compress far better than with none.
    const out = y * (stride + 1);
    raw[out] = 1;
    const row = y * stride;
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? (pixels[row + x - channels] ?? 0) : 0;
      raw[out + 1 + x] = ((pixels[row + x] ?? 0) - left) & 0xff;
    }
  }
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw, { level: 6 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}
