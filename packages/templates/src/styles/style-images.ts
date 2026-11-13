// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Logo bytes, decided by magic (P3-V10): PNG, JPEG or WebP, at most LOGO_LIMITS. SVG is refused — it can
 * carry script into the render's browser. The file name is never consulted.
 */
import { err, LOGO_LIMITS, ok, type LogoMediaType, type Result } from '@taalcut/core';
import { StyleImageInvalid } from '../errors';

export interface SniffedLogo {
  readonly mediaType: LogoMediaType;
  readonly width: number;
  readonly height: number;
}

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

function at(bytes: Uint8Array, offset: number): number {
  return bytes[offset] ?? 0;
}

function u16(bytes: Uint8Array, offset: number): number {
  return (at(bytes, offset) << 8) | at(bytes, offset + 1);
}

function u32(bytes: Uint8Array, offset: number): number {
  return (
    (at(bytes, offset) * 0x1000000 +
      (at(bytes, offset + 1) << 16) +
      (at(bytes, offset + 2) << 8) +
      at(bytes, offset + 3)) >>>
    0
  );
}

function ascii(bytes: Uint8Array, offset: number, text: string): boolean {
  for (let i = 0; i < text.length; i++) if (at(bytes, offset + i) !== text.charCodeAt(i)) return false;
  return true;
}

/** IHDR width and height. The chunk starts 8 bytes after the signature. */
function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24 || !PNG.every((byte, index) => at(bytes, index) === byte)) return null;
  if (!ascii(bytes, 12, 'IHDR')) return null;
  return { width: u32(bytes, 16), height: u32(bytes, 20) };
}

/** The first SOF marker's dimensions. SOF is not DHT (c4), JPG (c8) or DAC (cc). */
function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 4 || at(bytes, 0) !== 0xff || at(bytes, 1) !== 0xd8) return null;
  let i = 2;
  while (i + 3 < bytes.length) {
    if (at(bytes, i) !== 0xff) return null;
    while (at(bytes, i) === 0xff) i += 1;
    const marker = at(bytes, i);
    i += 1;
    if (marker === 0xd8) continue;
    if (marker === 0xd9 || marker === 0xda) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    const length = u16(bytes, i);
    if (length < 2 || i + length > bytes.length) return null;
    const sof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (sof) {
      if (length < 7) return null;
      return { width: u16(bytes, i + 5), height: u16(bytes, i + 3) };
    }
    i += length;
  }
  return null;
}

/** VP8, VP8L or VP8X canvas size. A later chunk is not required. */
function webpSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 30 || !ascii(bytes, 0, 'RIFF') || !ascii(bytes, 8, 'WEBP')) return null;
  if (ascii(bytes, 12, 'VP8 ')) {
    const key = at(bytes, 20);
    if ((key & 1) !== 0) return null;
    if (at(bytes, 23) !== 0x9d || at(bytes, 24) !== 0x01 || at(bytes, 25) !== 0x2a) return null;
    const width = at(bytes, 26) | (at(bytes, 27) << 8);
    const height = at(bytes, 28) | (at(bytes, 29) << 8);
    return { width: width & 0x3fff, height: height & 0x3fff };
  }
  if (ascii(bytes, 12, 'VP8L')) {
    if (at(bytes, 20) !== 0x2f) return null;
    const bits = at(bytes, 21) + (at(bytes, 22) << 8) + (at(bytes, 23) << 16) + at(bytes, 24) * 0x1000000;
    return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff) };
  }
  if (ascii(bytes, 12, 'VP8X')) {
    const width = 1 + (at(bytes, 24) | (at(bytes, 25) << 8) | (at(bytes, 26) << 16));
    const height = 1 + (at(bytes, 27) | (at(bytes, 28) << 8) | (at(bytes, 29) << 16));
    return { width, height };
  }
  return null;
}

function decoded(bytes: Uint8Array): { mediaType: LogoMediaType; width: number; height: number } | null {
  const png = pngSize(bytes);
  if (png) return { mediaType: 'image/png', ...png };
  const jpeg = jpegSize(bytes);
  if (jpeg) return { mediaType: 'image/jpeg', ...jpeg };
  const webp = webpSize(bytes);
  if (webp) return { mediaType: 'image/webp', ...webp };
  return null;
}

/** PNG, JPEG or WebP within LOGO_LIMITS, or `templates.style_image_invalid`. */
export function sniffLogo(bytes: Uint8Array): Result<SniffedLogo> {
  if (bytes.byteLength > LOGO_LIMITS.bytes) return err(StyleImageInvalid({ reason: 'size' }));
  const image = decoded(bytes);
  if (!image || image.width < 1 || image.height < 1) return err(StyleImageInvalid({ reason: 'type' }));
  if (image.width > LOGO_LIMITS.pixels || image.height > LOGO_LIMITS.pixels)
    return err(StyleImageInvalid({ reason: 'pixels' }));
  return ok(image);
}
