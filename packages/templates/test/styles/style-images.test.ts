// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Logo sniffing (P3-V10): magic bytes, never the file name. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LOGO_LIMITS } from '@taalcut/core';
import { nodeImageReader } from '../../src/styles/node-image-reader';
import { sniffLogo } from '../../src/styles/style-images';

function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13], 0);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  bytes[16] = (width >>> 24) & 255;
  bytes[17] = (width >>> 16) & 255;
  bytes[18] = (width >>> 8) & 255;
  bytes[19] = width & 255;
  bytes[20] = (height >>> 24) & 255;
  bytes[21] = (height >>> 16) & 255;
  bytes[22] = (height >>> 8) & 255;
  bytes[23] = height & 255;
  return bytes;
}

/** 1×1 JPEG: SOF0 height at offset 7, width at offset 9. */
function jpeg1x1(): Uint8Array {
  return Uint8Array.from([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xd9,
  ]);
}

/** 1×1 WebP VP8X: width-1 and height-1 are the 24-bit zeros at 24 and 27. */
function webp1x1(): Uint8Array {
  const bytes = new Uint8Array(30);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0);
  bytes[4] = 22;
  bytes.set([0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58], 8);
  bytes[16] = 10;
  return bytes;
}

describe('logo sniffing', () => {
  it('accepts PNG, JPEG and WebP and reads their dimensions', () => {
    const pngLogo = sniffLogo(png(16, 32));
    const jpegLogo = sniffLogo(jpeg1x1());
    const webpLogo = sniffLogo(webp1x1());
    expect(pngLogo.ok ? pngLogo.value : null).toMatchObject({
      mediaType: 'image/png',
      width: 16,
      height: 32,
    });
    expect(jpegLogo.ok ? jpegLogo.value : null).toMatchObject({
      mediaType: 'image/jpeg',
      width: 1,
      height: 1,
    });
    expect(webpLogo.ok ? webpLogo.value : null).toMatchObject({
      mediaType: 'image/webp',
      width: 1,
      height: 1,
    });
    expect(sniffLogo(png(LOGO_LIMITS.pixels, 16)).ok).toBe(true);
  });

  it('refuses SVG, renamed text, a file over 5 MiB and a side of 4097', () => {
    const svg = sniffLogo(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'));
    const text = sniffLogo(new TextEncoder().encode('not an image'));
    const oversize = sniffLogo(new Uint8Array(LOGO_LIMITS.bytes + 1));
    const wide = sniffLogo(png(LOGO_LIMITS.pixels + 1, 16));
    expect(svg.ok).toBe(false);
    expect(text.ok).toBe(false);
    if (!svg.ok) expect(svg.error.params).toEqual({ reason: 'type' });
    if (!text.ok) expect(text.error.params).toEqual({ reason: 'type' });
    expect(oversize.ok).toBe(false);
    if (!oversize.ok) expect(oversize.error.params).toEqual({ reason: 'size' });
    expect(wide.ok).toBe(false);
    if (!wide.ok) expect(wide.error.params).toEqual({ reason: 'pixels' });
  });
});

describe('nodeImageReader', () => {
  it('refuses a file over the limit before reading it, and a missing one as not found', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'taalcut-logo-'));
    try {
      const small = join(dir, 'logo.png');
      const big = join(dir, 'film.mov');
      await writeFile(small, png(64, 64));
      await writeFile(big, new Uint8Array(65));
      const read = nodeImageReader(64);
      const ok = await read(small);
      expect(ok.ok && Array.from(ok.value)).toEqual(Array.from(png(64, 64)));
      const tooBig = await read(big);
      expect(tooBig.ok ? null : tooBig.error).toMatchObject({
        code: 'templates.style_image_invalid',
        params: { reason: 'size' },
      });
      const missing = await read(join(dir, 'gone.png'));
      expect(missing.ok ? null : missing.error.code).toBe('core.not_found');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
