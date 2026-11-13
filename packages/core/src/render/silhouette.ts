// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FRM1-SUB: the subject track's silhouette grid (subject-track.ts `silhouetteSchema`): one bit per cell,
 * row-major from the top left, most significant bit first, base64. Pure, and free of Node and DOM, so render,
 * timeline and the renderer read it the same way.
 */
import type { Silhouette } from './subject-track';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0;
    const b = bytes[i + 1] ?? 0;
    const c = bytes[i + 2] ?? 0;
    const triple = (a << 16) | (b << 8) | c;
    out += ALPHABET[(triple >> 18) & 63]! + ALPHABET[(triple >> 12) & 63]!;
    out += i + 1 < bytes.length ? ALPHABET[(triple >> 6) & 63]! : '=';
    out += i + 2 < bytes.length ? ALPHABET[triple & 63]! : '=';
  }
  return out;
}

function fromBase64(text: string): Uint8Array {
  const clean = text.replace(/=+$/, '');
  const bytes = new Uint8Array(Math.floor((clean.length * 6) / 8));
  let buffer = 0;
  let bits = 0;
  let index = 0;
  for (const char of clean) {
    buffer = (buffer << 6) | ALPHABET.indexOf(char);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[index++] = (buffer >> bits) & 255;
    }
  }
  return bytes;
}

/** A grid from its cells, row-major from the top left (`cells.length` must be `cols * rows`). */
export function encodeSilhouette(cols: number, rows: number, cells: ArrayLike<boolean | number>): Silhouette {
  if (cells.length !== cols * rows) throw new Error('encodeSilhouette needs cols * rows cells');
  const bytes = new Uint8Array(Math.ceil((cols * rows) / 8));
  for (let i = 0; i < cells.length; i++) if (cells[i]) bytes[i >> 3]! |= 0x80 >> (i & 7);
  return { cols, rows, bits: toBase64(bytes) };
}

/** Every cell, row-major from the top left. */
export function silhouetteCells(grid: Silhouette): boolean[] {
  const bytes = fromBase64(grid.bits);
  const cells: boolean[] = [];
  for (let i = 0; i < grid.cols * grid.rows; i++)
    cells.push(((bytes[i >> 3] ?? 0) & (0x80 >> (i & 7))) !== 0);
  return cells;
}

/** Whether people cover the cell under a point of the frame (fractions, origin top left). */
export function silhouetteCell(
  grid: Silhouette,
  x: number,
  y: number,
  cells = silhouetteCells(grid),
): boolean {
  const col = Math.min(grid.cols - 1, Math.max(0, Math.floor(x * grid.cols)));
  const row = Math.min(grid.rows - 1, Math.max(0, Math.floor(y * grid.rows)));
  return cells[row * grid.cols + col] ?? false;
}

/** The share (0–1) of a box's area, in frame fractions, that falls on set cells. */
export function silhouetteShare(
  grid: Silhouette,
  box: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
  cells = silhouetteCells(grid),
): number {
  const area = box.width * box.height;
  if (area <= 0) return 0;
  let covered = 0;
  for (let row = 0; row < grid.rows; row++) {
    const y0 = row / grid.rows;
    const y1 = (row + 1) / grid.rows;
    const dy = Math.min(y1, box.y + box.height) - Math.max(y0, box.y);
    if (dy <= 0) continue;
    for (let col = 0; col < grid.cols; col++) {
      if (!cells[row * grid.cols + col]) continue;
      const dx = Math.min((col + 1) / grid.cols, box.x + box.width) - Math.max(col / grid.cols, box.x);
      if (dx > 0) covered += dx * dy;
    }
  }
  return Math.min(1, covered / area);
}
