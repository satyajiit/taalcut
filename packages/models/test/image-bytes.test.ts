// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** What a still is, read from its bytes: type, pixel size and whether it fits the aspect asked for. */
import { describe, expect, it } from 'vitest';
import { fitsAspect, imageFacts } from '@taalcut/models';
import { jpeg, png } from './support/image-wire';

/** A WebP RIFF header with the given chunk and its first payload bytes. */
function webp(chunk: string, payload: number[]): Uint8Array {
  const bytes = new Uint8Array(40);
  bytes.set(
    [...'RIFF'].map((c) => c.charCodeAt(0)),
    0,
  );
  bytes.set(
    [...'WEBP'].map((c) => c.charCodeAt(0)),
    8,
  );
  bytes.set(
    [...chunk].map((c) => c.charCodeAt(0)),
    12,
  );
  bytes.set(payload, 20);
  return bytes;
}

describe('imageFacts', () => {
  it('reads PNG and JPEG sizes from their headers', () => {
    expect(imageFacts(png(1024, 1536))).toEqual({ mediaType: 'image/png', width: 1024, height: 1536 });
    expect(imageFacts(jpeg(1152, 2048))).toEqual({ mediaType: 'image/jpeg', width: 1152, height: 2048 });
  });

  it('reads the three WebP headers', () => {
    // VP8: frame tag (3 bytes), start code, then 14-bit width and height at offsets 26 and 28.
    const lossy = webp('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a, 0x00, 0x04, 0x00, 0x07]);
    expect(imageFacts(lossy)).toEqual({ mediaType: 'image/webp', width: 1024, height: 1792 });
    // VP8L: signature 0x2f, then 14-bit width-1 and height-1 packed little-endian.
    const w = 1023;
    const h = 1791;
    const bits = w | (h << 14);
    const lossless = webp('VP8L', [
      0x2f,
      bits & 0xff,
      (bits >> 8) & 0xff,
      (bits >> 16) & 0xff,
      (bits >> 24) & 0xff,
    ]);
    expect(imageFacts(lossless)).toEqual({ mediaType: 'image/webp', width: 1024, height: 1792 });
    // VP8X: 24-bit width-1 and height-1 at offsets 24 and 27.
    const extended = webp('VP8X', [0, 0, 0, 0, 0xff, 0x03, 0x00, 0xff, 0x06, 0x00]);
    expect(imageFacts(extended)).toEqual({ mediaType: 'image/webp', width: 1024, height: 1792 });
  });

  it('is undefined for anything else', () => {
    expect(imageFacts(new TextEncoder().encode('<html>no image</html>'))).toBeUndefined();
    expect(imageFacts(new Uint8Array([0xff, 0xd8, 0x00]))).toBeUndefined();
    expect(imageFacts(new Uint8Array())).toBeUndefined();
  });
});

describe('fitsAspect', () => {
  it('checks orientation, squareness and a usable size', () => {
    expect(fitsAspect({ width: 1024, height: 1536 }, '9:16')).toBe(true);
    expect(fitsAspect({ width: 1024, height: 1536 }, '4:5')).toBe(true);
    expect(fitsAspect({ width: 1536, height: 1024 }, '9:16')).toBe(false);
    expect(fitsAspect({ width: 1536, height: 1024 }, '16:9')).toBe(true);
    expect(fitsAspect({ width: 1024, height: 1000 }, '1:1')).toBe(true);
    expect(fitsAspect({ width: 1024, height: 768 }, '1:1')).toBe(false);
    expect(fitsAspect({ width: 128, height: 256 }, '9:16')).toBe(false);
  });
});
