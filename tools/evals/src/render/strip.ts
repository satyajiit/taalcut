// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * 40 cells across the top `cellSize` rows. Cells 0..31 are the Gray code of
 * the source frame (bit 0, the least significant bit, is cell 0). Cells
 * 32..39 are the Gray code of the clip id. A set bit is luma 255.
 */

export interface PaintFrameOptions {
  width: number;
  height: number;
  cellSize: number;
  frame: number;
  clipId: number;
  color: string;
}

export interface StripReading {
  frame: number;
  clipId: number;
}

export function toGray(value: number): number {
  const n = value >>> 0;
  return (n ^ (n >>> 1)) >>> 0;
}

/** Fold the upper bits back. The mask walk covers 32 bits. */
export function fromGray(gray: number): number {
  let n = gray >>> 0;
  let mask = n >>> 1;
  while (mask !== 0) {
    n = (n ^ mask) >>> 0;
    mask >>>= 1;
  }
  return n >>> 0;
}

function parseColor(color: string): { r: number; g: number; b: number } {
  const match = /^#([0-9a-fA-F]{6})$/.exec(color);
  const hex = match?.[1];
  if (hex === undefined) throw new Error(`color must be #RRGGBB, got ${color}`);
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
  };
}

export function paintFrame(opts: PaintFrameOptions): Buffer {
  const { width, height, cellSize, frame, clipId, color } = opts;
  if (width !== 40 * cellSize) throw new Error('width must be 40 * cellSize');
  if (height < cellSize) throw new Error('height must cover the timing strip');
  const { r, g, b } = parseColor(color);
  const buffer = Buffer.alloc(width * height * 3);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    buffer[pixel * 3] = r;
    buffer[pixel * 3 + 1] = g;
    buffer[pixel * 3 + 2] = b;
  }
  const frameGray = toGray(frame);
  const clipGray = toGray(clipId) & 0xff;
  for (let y = 0; y < cellSize; y += 1) {
    for (let cell = 0; cell < 40; cell += 1) {
      const bit = cell < 32 ? (frameGray >>> cell) & 1 : (clipGray >>> (cell - 32)) & 1;
      const luma = bit === 1 ? 255 : 0;
      const x0 = cell * cellSize;
      for (let x = x0; x < x0 + cellSize; x += 1) {
        const offset = (y * width + x) * 3;
        buffer[offset] = luma;
        buffer[offset + 1] = luma;
        buffer[offset + 2] = luma;
      }
    }
  }
  return buffer;
}

/** Center pixel of each cell. Luma >= 128 is a set bit. */
export function readStrip(rgb: Buffer, width: number, height: number, cellSize: number): StripReading {
  const need = width * height * 3;
  if (rgb.length < need) throw new Error(`frame buffer is ${rgb.length} bytes, expected at least ${need}`);
  if (cellSize < 1) throw new Error('cellSize must be positive');
  const y = Math.floor(cellSize / 2);
  let frameGray = 0;
  let clipGray = 0;
  for (let cell = 0; cell < 40; cell += 1) {
    const x = cell * cellSize + Math.floor(cellSize / 2);
    const offset = (y * width + x) * 3;
    const red = rgb[offset] ?? 0;
    const green = rgb[offset + 1] ?? 0;
    const blue = rgb[offset + 2] ?? 0;
    const luma = (red + green + blue) / 3;
    if (luma < 128) continue;
    if (cell < 32) frameGray += 2 ** cell;
    else clipGray += 2 ** (cell - 32);
  }
  return { frame: fromGray(frameGray), clipId: fromGray(clipGray) & 0xff };
}
