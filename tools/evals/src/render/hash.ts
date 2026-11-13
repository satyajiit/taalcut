// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { z } from 'zod';
import { parseNamed } from '../schema';

/** Distance 6 passes. Distance 7 fails. */
export function hashPasses(distance: number): boolean {
  return distance <= 6;
}

export function hamming(a: string, b: string): number {
  const left = a.toLowerCase();
  const right = b.toLowerCase();
  if (!/^[0-9a-f]{16}$/.test(left) || !/^[0-9a-f]{16}$/.test(right)) {
    throw new Error('dHash must be 16 hex characters');
  }
  let count = 0;
  for (let i = 0; i < 16; i += 1) {
    const xor = Number.parseInt(left[i] ?? '0', 16) ^ Number.parseInt(right[i] ?? '0', 16);
    let bits = xor;
    while (bits !== 0) {
      count += bits & 1;
      bits >>>= 1;
    }
  }
  return count;
}

function lumaAt(rgb: Buffer, width: number, x: number, y: number, cellSize: number): number {
  if (y < cellSize) return 128;
  const offset = (y * width + x) * 3;
  const red = rgb[offset] ?? 0;
  const green = rgb[offset + 1] ?? 0;
  const blue = rgb[offset + 2] ?? 0;
  return (red + green + blue) / 3;
}

/**
 * Mask the strip rows to luma 128, box-downsample to 9×8, then 8×8
 * horizontal comparisons. 64 bits, written as 16 lowercase hex characters.
 */
export function dHash(rgb: Buffer, width: number, height: number, cellSize: number): string {
  const cols = 9;
  const rows = 8;
  const grid: number[][] = [];
  for (let by = 0; by < rows; by += 1) {
    const y0 = Math.floor((by * height) / rows);
    const y1 = Math.max(y0 + 1, Math.min(height, Math.floor(((by + 1) * height) / rows)));
    const row: number[] = [];
    for (let bx = 0; bx < cols; bx += 1) {
      const x0 = Math.floor((bx * width) / cols);
      const x1 = Math.max(x0 + 1, Math.min(width, Math.floor(((bx + 1) * width) / cols)));
      let sum = 0;
      let count = 0;
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          sum += lumaAt(rgb, width, x, y, cellSize);
          count += 1;
        }
      }
      row.push(count === 0 ? 0 : sum / count);
    }
    grid.push(row);
  }
  const bytes = new Uint8Array(8);
  let bitIndex = 0;
  for (let rowIndex = 0; rowIndex < rows; rowIndex += 1) {
    const row = grid[rowIndex];
    for (let col = 0; col < 8; col += 1) {
      const left = row?.[col] ?? 0;
      const right = row?.[col + 1] ?? 0;
      if (left > right) {
        const byte = bitIndex >> 3;
        bytes[byte] = (bytes[byte] ?? 0) | (1 << (7 - (bitIndex & 7)));
      }
      bitIndex += 1;
    }
  }
  return Buffer.from(bytes).toString('hex');
}

export interface HashSample {
  outputFrame: number;
  dHash: string;
}

const hashSampleSchema = z
  .object({
    outputFrame: z.number().int().nonnegative(),
    dHash: z.string().regex(/^[0-9a-fA-F]{16}$/),
  })
  .strict();

export const approvedHashSchema = z
  .object({
    synthetic: z.boolean(),
    frames: z.array(hashSampleSchema),
  })
  .strict();

export type ApprovedHashes = z.infer<typeof approvedHashSchema>;

export function parseApprovedHashes(input: unknown, label = 'hashes.json'): ApprovedHashes {
  return parseNamed(approvedHashSchema, input, label);
}

/** Every 10th output frame, plus any extra frames that fall inside the reel. */
export function everyTenthAnd(duration: number, extra: readonly number[]): number[] {
  const frames = new Set<number>();
  for (let frame = 0; frame < duration; frame += 10) frames.add(frame);
  for (const frame of extra) {
    if (frame >= 0 && frame < duration) frames.add(frame);
  }
  return [...frames].sort((a, b) => a - b);
}
