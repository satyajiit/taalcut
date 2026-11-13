// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Header inspection for generated and sandbox-imported media (PNG, JPEG, WebP, MP4/QuickTime) so an asset
 * recorded through GeneratedAssetSink carries its dimensions, orientation and duration immediately, before
 * the background indexing worker probes it.
 */
import type { Orientation } from '@taalcut/core';
import type { StoredTime } from '../repositories/stored-time';

export interface GeneratedMediaProbe {
  readonly width: number | null;
  readonly height: number | null;
  readonly orientation: Orientation | null;
  readonly duration: StoredTime | null;
}

const EMPTY_PROBE: GeneratedMediaProbe = {
  width: null,
  height: null,
  orientation: null,
  duration: null,
};

function orientationOf(width: number | null, height: number | null): Orientation | null {
  if (!width || !height || width <= 0 || height <= 0) return null;
  if (width > height) return 'landscape';
  if (height > width) return 'portrait';
  return 'square';
}

function u16be(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
}

function u32be(bytes: Uint8Array, offset: number): number {
  return (
    (((bytes[offset] ?? 0) << 24) |
      ((bytes[offset + 1] ?? 0) << 16) |
      ((bytes[offset + 2] ?? 0) << 8) |
      (bytes[offset + 3] ?? 0)) >>>
    0
  );
}

function u64be(bytes: Uint8Array, offset: number): number {
  return u32be(bytes, offset) * 0x1_0000_0000 + u32be(bytes, offset + 4);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) out += String.fromCharCode(bytes[offset + i] ?? 0);
  return out;
}

function probePng(bytes: Uint8Array): GeneratedMediaProbe {
  if (bytes.byteLength < 24 || u32be(bytes, 0) !== 0x89504e47 || ascii(bytes, 12, 4) !== 'IHDR') {
    return EMPTY_PROBE;
  }
  const width = u32be(bytes, 16);
  const height = u32be(bytes, 20);
  if (width <= 0 || height <= 0) return EMPTY_PROBE;
  return { width, height, orientation: orientationOf(width, height), duration: null };
}

function probeJpeg(bytes: Uint8Array): GeneratedMediaProbe {
  if (bytes.byteLength < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return EMPTY_PROBE;
  let offset = 2;
  while (offset + 4 <= bytes.byteLength) {
    if (bytes[offset] !== 0xff) {
      offset++;
      continue;
    }
    while (offset < bytes.byteLength && bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === undefined || marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.byteLength) break;
    const length = u16be(bytes, offset);
    if (length < 2 || offset + length > bytes.byteLength) break;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (length >= 7) {
        const height = u16be(bytes, offset + 3);
        const width = u16be(bytes, offset + 5);
        if (width > 0 && height > 0) {
          return { width, height, orientation: orientationOf(width, height), duration: null };
        }
      }
      break;
    }
    offset += length;
  }
  return EMPTY_PROBE;
}

function probeWebp(bytes: Uint8Array): GeneratedMediaProbe {
  if (bytes.byteLength < 30 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP') {
    return EMPTY_PROBE;
  }
  const chunk = ascii(bytes, 12, 4);
  let width = 0;
  let height = 0;
  if (chunk === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    width = (bytes[26]! | (bytes[27]! << 8)) & 0x3fff;
    height = (bytes[28]! | (bytes[29]! << 8)) & 0x3fff;
  } else if (chunk === 'VP8L' && bytes[20] === 0x2f) {
    const bits =
      bytes[21]! | (bytes[22]! << 8) | (bytes[23]! << 16) | ((bytes[24]! << 24) >>> 0);
    width = (bits & 0x3fff) + 1;
    height = ((bits >>> 14) & 0x3fff) + 1;
  } else if (chunk === 'VP8X') {
    width = 1 + (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16));
    height = 1 + (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16));
  }
  if (width <= 0 || height <= 0) return EMPTY_PROBE;
  return { width, height, orientation: orientationOf(width, height), duration: null };
}

function probeIsoBmff(bytes: Uint8Array): GeneratedMediaProbe {
  let width: number | null = null;
  let height: number | null = null;
  let duration: StoredTime | null = null;

  function walk(start: number, end: number): void {
    let pos = start;
    while (pos + 8 <= end) {
      let size = u32be(bytes, pos);
      const type = ascii(bytes, pos + 4, 4);
      let header = 8;
      if (size === 1) {
        if (pos + 16 > end) break;
        size = u64be(bytes, pos + 8);
        header = 16;
      } else if (size === 0) {
        size = end - pos;
      }
      if (size < header || pos + size > end) break;
      const body = pos + header;
      const boxEnd = pos + size;
      if (type === 'moov' || type === 'trak' || type === 'mdia') {
        walk(body, boxEnd);
      } else if (type === 'mvhd' && body + 20 <= boxEnd) {
        const version = bytes[body];
        const timescale = version === 1 && body + 32 <= boxEnd ? u32be(bytes, body + 20) : u32be(bytes, body + 12);
        const units = version === 1 && body + 32 <= boxEnd ? u64be(bytes, body + 24) : u32be(bytes, body + 16);
        if (timescale > 0 && units > 0) {
          const frames = Math.max(1, Math.round((units * 30) / timescale));
          duration = { value: frames, rate: { num: 30, den: 1 } };
        }
      } else if (type === 'tkhd' && width === null && body + 84 <= boxEnd) {
        const version = bytes[body];
        const dimOffset = version === 1 ? body + 88 : body + 76;
        if (dimOffset + 8 <= boxEnd) {
          const w = Math.round(u32be(bytes, dimOffset) / 65536);
          const h = Math.round(u32be(bytes, dimOffset + 4) / 65536);
          if (w > 0 && h > 0) {
            width = w;
            height = h;
          }
        }
      }
      pos = boxEnd;
    }
  }

  walk(0, bytes.byteLength);
  return { width, height, orientation: orientationOf(width, height), duration };
}

export function probeGeneratedMedia(bytes: Uint8Array, mediaType: string): GeneratedMediaProbe {
  const clean = mediaType.trim().toLowerCase();
  if (clean === 'image/png') return probePng(bytes);
  if (clean === 'image/jpeg') return probeJpeg(bytes);
  if (clean === 'image/webp') return probeWebp(bytes);
  if (clean === 'video/mp4' || clean === 'video/quicktime') return probeIsoBmff(bytes);
  return EMPTY_PROBE;
}
