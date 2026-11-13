// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Reads width and height from PNG and JPEG headers, so callers get dimensions without decoding. */

export interface ImageSize {
  readonly width: number;
  readonly height: number;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function imageSize(data: Uint8Array): ImageSize | undefined {
  return pngSize(data) ?? jpegSize(data);
}

function u16(data: Uint8Array, at: number): number {
  return ((data[at] ?? 0) << 8) | (data[at + 1] ?? 0);
}

function u32(data: Uint8Array, at: number): number {
  return u16(data, at) * 0x10000 + u16(data, at + 2);
}

function pngSize(data: Uint8Array): ImageSize | undefined {
  if (data.length < 24 || !PNG_SIGNATURE.every((byte, i) => data[i] === byte)) return undefined;
  // The first chunk is IHDR: width and height are its first two fields.
  if (String.fromCharCode(...data.subarray(12, 16)) !== 'IHDR') return undefined;
  return { width: u32(data, 16), height: u32(data, 20) };
}

/** Start-of-frame markers (baseline, progressive, lossless, arithmetic), which carry the size. */
function isStartOfFrame(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

function jpegSize(data: Uint8Array): ImageSize | undefined {
  if (data[0] !== 0xff || data[1] !== 0xd8) return undefined;
  let at = 2;
  while (at + 9 < data.length) {
    if (data[at] !== 0xff) return undefined;
    const marker = data[at + 1] ?? 0;
    if (marker === 0xff) {
      at += 1; // fill byte
      continue;
    }
    if (isStartOfFrame(marker)) return { height: u16(data, at + 5), width: u16(data, at + 7) };
    // Markers without a length field: TEM, RST0–7, SOI.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      at += 2;
      continue;
    }
    at += 2 + u16(data, at + 2);
  }
  return undefined;
}
