// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { decodePngRgb } from '../../src/look/png-rgb';
import { encodePng, PNG_SIGNATURE as SIGNATURE, pngChunk as chunk } from '../../src/media/png';

function ihdr(width: number, height: number, colorType: number, interlace = 0): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = colorType;
  header[12] = interlace;
  return header;
}

function png(header: Buffer, raw: Buffer): Buffer {
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

describe('decodePngRgb', () => {
  it('round-trips the encoder, including its Sub filter and gray', () => {
    const rgb = Uint8Array.of(10, 20, 30, 40, 50, 60, 70, 80, 90, 1, 2, 3);
    const decoded = decodePngRgb(encodePng(rgb, 2, 2));
    expect(decoded.ok && Array.from(decoded.value.rgb)).toEqual(Array.from(rgb));
    const gray = Uint8Array.of(4, 5, 6, 7);
    const expanded = decodePngRgb(encodePng(gray, 2, 2, 1));
    expect(expanded.ok && Array.from(expanded.value.rgb)).toEqual([4, 4, 4, 5, 5, 5, 6, 6, 6, 7, 7, 7]);
  });

  it('drops alpha on a filter-None RGBA image', () => {
    const raw = Uint8Array.of(0, 255, 0, 0, 128, 0, 0, 255, 64);
    const decoded = decodePngRgb(png(ihdr(2, 1, 6), Buffer.from(raw)));
    expect(decoded.ok && Array.from(decoded.value.rgb)).toEqual([255, 0, 0, 0, 0, 255]);
  });

  it('reconstructs Up, Average and Paeth', () => {
    // Two RGB pixels. Row 0 is None. Row 1 is Up of the same pixels (filter bytes only).
    const row0 = Uint8Array.of(0, 9, 8, 7, 6, 5, 4);
    const up = Uint8Array.of(2, 0, 0, 0, 0, 0, 0);
    const decoded = decodePngRgb(png(ihdr(2, 2, 2), Buffer.concat([row0, up])));
    expect(decoded.ok && Array.from(decoded.value.rgb)).toEqual([9, 8, 7, 6, 5, 4, 9, 8, 7, 6, 5, 4]);
    // Average of a flat row: predictor is half the left neighbour, so the stored delta is the rest.
    // Average: the second pixel's predictor is half the left sample (10 → 5), so a stored 5 reconstructs 10.
    const average = Uint8Array.of(3, 10, 0, 0, 5, 0, 0);
    const averaged = decodePngRgb(png(ihdr(2, 1, 2), Buffer.from(average)));
    expect(averaged.ok && Array.from(averaged.value.rgb)).toEqual([10, 0, 0, 10, 0, 0]);
    const paeth = Uint8Array.of(4, 3, 0, 0, 1, 0, 0);
    const predicted = decodePngRgb(png(ihdr(2, 1, 2), Buffer.from(paeth)));
    expect(predicted.ok && Array.from(predicted.value.rgb)).toEqual([3, 0, 0, 4, 0, 0]);
  });

  it('refuses interlace, palette, a bad crc and a truncated file', () => {
    const raw = Uint8Array.of(0, 1, 2, 3);
    expect(decodePngRgb(png(ihdr(1, 1, 2, 1), Buffer.from(raw))).ok).toBe(false);
    expect(decodePngRgb(png(ihdr(1, 1, 3), Buffer.from([0, 0]))).ok).toBe(false);
    const file = png(ihdr(1, 1, 2), Buffer.from(raw));
    // Byte 29 is the IHDR crc. Flipping it must fail the check, not the pixels.
    file[29] = (file[29] ?? 0) ^ 0xff;
    expect(decodePngRgb(file).ok).toBe(false);
    expect(decodePngRgb(file.subarray(0, 20)).ok).toBe(false);
    expect(decodePngRgb(Uint8Array.of(1, 2, 3)).ok).toBe(false);
  });
});
