// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * In-place text fixtures without a font library (IX-O4): a 5 × 7 pixel font
 * (the bench footage's glyphs, plus ':'), drawn scaled up onto RGB frames over
 * moving or textured backgrounds. Vision reads these blocky letters: the
 * bench footage's burnt-in lines use the same font.
 */
import type { OcrFrame } from '../../../src/ocr/types';

const GLYPHS: Readonly<Record<string, readonly string[]>> = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['01110', '00100', '00100', '00100', '00100', '00100', '01110'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '10001', '11001', '10101', '10011', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '10101', '01010'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  G: ['01110', '10001', '10000', '10111', '10001', '10001', '01111'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  '.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'],
  ':': ['00000', '01100', '01100', '00000', '01100', '01100', '00000'],
};

export type Background = (x: number, y: number, frame: number) => readonly [number, number, number];

/** Diagonal stripes that move with the frame: moving content behind a clock. */
export const movingStripes: Background = (x, y, frame) => {
  const v = (x + y + frame * 6) % 64 < 32 ? 70 : 140;
  return [v, v / 2, 200 - v];
};

/** A plain studio backdrop. */
export const backdrop: Background = () => [40, 60, 90];

/** A busy, high-contrast texture that changes every frame (the fractal/life looks' stand-in). */
export const busyTexture: Background = (x, y, frame) => {
  let h = (x * 374761393 + y * 668265263 + frame * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  const cell = ((x >> 3) + (y >> 3) + frame) % 3;
  const v = (h >>> 24) & 0xff;
  return cell === 0 ? [v, 255 - v, v] : cell === 1 ? [255 - v, v, 40] : [v, v, v];
};

export interface Overlay {
  readonly text: string;
  /** Top-left corner in pixels and the size of one font pixel. */
  readonly left: number;
  readonly top: number;
  readonly scale: number;
}

/** A frame of `width` × `height` with the overlays drawn as white letters on a dark band. */
export function pixelFrame(
  index: number,
  width: number,
  height: number,
  background: Background,
  overlays: readonly Overlay[],
): OcrFrame {
  const rgb = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) rgb.set(background(x, y, index), (y * width + x) * 3);
  for (const { text, left, top, scale } of overlays) {
    const chars = [...text.toUpperCase()];
    const bandWidth = (chars.length * 6 + 1) * scale;
    const bandHeight = 9 * scale;
    for (let y = top; y < Math.min(height, top + bandHeight); y++)
      for (let x = left; x < Math.min(width, left + bandWidth); x++)
        rgb.fill(24, (y * width + x) * 3, (y * width + x) * 3 + 3);
    chars.forEach((char, n) => {
      const rows = GLYPHS[char];
      if (!rows) throw new Error(`no pixel glyph for '${char}'`);
      rows.forEach((bits, gy) =>
        [...bits].forEach((bit, gx) => {
          if (bit !== '1') return;
          for (let dy = 0; dy < scale; dy++)
            for (let dx = 0; dx < scale; dx++) {
              const x = left + (n * 6 + 1 + gx) * scale + dx;
              const y = top + (gy + 1) * scale + dy;
              if (x < width && y < height) rgb.fill(245, (y * width + x) * 3, (y * width + x) * 3 + 3);
            }
        }),
      );
    });
  }
  return { index, width, height, rgb };
}

/**
 * The frame softened by a box blur of `radius` pixels, as scaling and encoding soften burnt-in text in footage.
 * Vision reads the sharp blocky glyphs less reliably than softened ones (IX-O4 probe: a clock over moving
 * stripes read 3 of 3 times at radius 2, 2 of 3 sharp).
 */
export function soften(frame: OcrFrame, radius: number): OcrFrame {
  const { width, height, rgb } = frame;
  const pass = (src: Float32Array | Uint8Array, dx: number, dy: number) => {
    const out = new Float32Array(src.length);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++)
        for (let c = 0; c < 3; c++) {
          let sum = 0;
          let n = 0;
          for (let d = -radius; d <= radius; d++) {
            const xx = x + d * dx;
            const yy = y + d * dy;
            if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
            sum += src[(yy * width + xx) * 3 + c] ?? 0;
            n++;
          }
          out[(y * width + x) * 3 + c] = sum / n;
        }
    return out;
  };
  const blurred = pass(pass(rgb, 1, 0), 0, 1);
  return { ...frame, rgb: Uint8Array.from(blurred, (v) => Math.round(v)) };
}

/** testsrc2's clock for a grid frame at `fps`: hh:mm:ss.mmm. */
export function clockText(frame: number, fps: number): string {
  const ms = Math.round((frame / fps) * 1000);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(Math.floor(ms / 3_600_000))}:${pad(Math.floor(ms / 60_000) % 60)}:${pad(Math.floor(ms / 1000) % 60)}.${pad(ms % 1000, 3)}`;
}
