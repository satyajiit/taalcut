// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Decodes the fixture PNGs (8-bit, non-interlaced gray, gray+alpha, RGB or
 * RGBA) to rgb24 for tests with the package's own decoder (`decodePngPixels`).
 * `composite` blends a decoded overlay onto a canvas by its alpha.
 */
import { readFileSync } from 'node:fs';
import { unwrap } from '@taalcut/core';
import { decodePngPixels } from '../../../src/look/png-rgb';

export interface DecodedPng {
  readonly width: number;
  readonly height: number;
  /** rgb24. */
  readonly data: Uint8Array;
  /** Alpha 0–255 per pixel (255 when the PNG has none). */
  readonly alpha: Uint8Array;
}

/** The package's decoder, reshaped to rgb24 plus a separate alpha plane. Throws on a bad fixture. */
export function decodePng(bytes: Uint8Array): DecodedPng {
  const { width, height, channels, pixels } = unwrap(decodePngPixels(bytes));
  const data = new Uint8Array(width * height * 3);
  const alpha = new Uint8Array(width * height).fill(255);
  const gray = channels <= 2;
  for (let i = 0; i < width * height; i++) {
    const p = i * channels;
    data[i * 3] = pixels[p] ?? 0;
    data[i * 3 + 1] = gray ? (pixels[p] ?? 0) : (pixels[p + 1] ?? 0);
    data[i * 3 + 2] = gray ? (pixels[p] ?? 0) : (pixels[p + 2] ?? 0);
    if (channels === 2) alpha[i] = pixels[p + 1] ?? 255;
    if (channels === 4) alpha[i] = pixels[p + 3] ?? 255;
  }
  return { width, height, data, alpha };
}

export function readPng(path: string): DecodedPng {
  return decodePng(readFileSync(path));
}

/** Paints `overlay` onto an rgb24 canvas at (left, top), blending by its alpha. */
export function composite(
  canvas: { width: number; height: number; data: Uint8Array },
  overlay: DecodedPng,
  left: number,
  top: number,
): void {
  for (let y = 0; y < overlay.height; y++) {
    const cy = top + y;
    if (cy < 0 || cy >= canvas.height) continue;
    for (let x = 0; x < overlay.width; x++) {
      const cx = left + x;
      if (cx < 0 || cx >= canvas.width) continue;
      const a = (overlay.alpha[y * overlay.width + x] ?? 255) / 255;
      for (let c = 0; c < 3; c++) {
        const o = (cy * canvas.width + cx) * 3 + c;
        const s = (y * overlay.width + x) * 3 + c;
        canvas.data[o] = Math.round((overlay.data[s] ?? 0) * a + (canvas.data[o] ?? 0) * (1 - a));
      }
    }
  }
}
