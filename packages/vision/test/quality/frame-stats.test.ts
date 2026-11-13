// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Frame statistics, dHash and phase correlation against plain references on random and shifted images. */
import { describe, expect, it } from 'vitest';
import { dHash, frameStats, frameStatsFallback, hamming } from '../../src/quality/frame-stats';
import { downsample, phaseShift } from '../../src/quality/shift';

/** Deterministic pseudo-random gray image. */
function noise(width: number, height: number, seed = 1): Uint8Array {
  let s = seed;
  const out = new Uint8Array(width * height);
  for (let i = 0; i < out.length; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    out[i] = s % 256;
  }
  return out;
}

/** A crop of a lightly blurred noise field moved by (dx, dy): what a camera move looks like on a thumbnail. */
function texture(size: number, dx: number, dy: number): Float32Array {
  const big = size * 2;
  const field = noise(big, big, 5);
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let sum = 0;
      for (let j = -1; j <= 1; j++)
        for (let i = -1; i <= 1; i++)
          sum += field[(y - dy + size / 2 + j) * big + (x - dx + size / 2 + i)] ?? 0;
      out[y * size + x] = sum / 9;
    }
  }
  return out;
}

function referenceLaplacianVariance(data: Uint8Array, width: number, height: number): number {
  const values: number[] = [];
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const at = (xx: number, yy: number) => data[yy * width + xx] as number;
      values.push(at(x, y - 1) + at(x, y + 1) + at(x - 1, y) + at(x + 1, y) - 4 * at(x, y));
    }
  }
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
}

describe('frameStats', () => {
  it('matches a plain Laplacian variance and luma statistics on random images', () => {
    for (const seed of [1, 7, 42]) {
      const data = noise(37, 23, seed);
      const stats = frameStats({ index: 3, width: 37, height: 23, data });
      expect(stats.index).toBe(3);
      expect(stats.laplacianVariance).toBeCloseTo(referenceLaplacianVariance(data, 37, 23), 6);
      const mean = data.reduce((a, b) => a + b, 0) / data.length;
      expect(stats.mean).toBeCloseTo(mean, 9);
      expect(stats.dark).toBeCloseTo(data.filter((v) => v <= 16).length / data.length, 9);
      expect(stats.bright).toBeCloseTo(data.filter((v) => v >= 235).length / data.length, 9);
      expect(stats.thumb).toHaveLength(64 * 64);
    }
  });

  it('flags a black frame by blackdetect’s rule and reads flat frames as zero variance', () => {
    const black = new Uint8Array(100 * 50).fill(12);
    const stats = frameStats({ index: 0, width: 100, height: 50, data: black });
    expect(stats.black).toBe(true);
    expect(stats.laplacianVariance).toBe(0);
    expect(stats.std).toBe(0);
    const grey = frameStats({ index: 0, width: 100, height: 50, data: new Uint8Array(5000).fill(128) });
    expect(grey.black).toBe(false);
  });

  it('logs the CPU route as a compute.fallback with its reason', () => {
    expect(frameStatsFallback()).toMatchObject({
      operation: 'vision.frameStats',
      wanted: ['webgpu'],
      reason: 'no_accelerator',
    });
  });
});

describe('dHash', () => {
  it('is 16 hex digits, stable, near for a small change and far for another picture', () => {
    const a = noise(90, 80, 3);
    const hash = dHash(a, 90, 80);
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
    expect(dHash(a, 90, 80)).toBe(hash);
    const brighter = a.map((v) => Math.min(255, v + 10));
    expect(hamming(hash, dHash(brighter, 90, 80))).toBeLessThanOrEqual(4);
    expect(hamming(hash, dHash(noise(90, 80, 99), 90, 80))).toBeGreaterThan(16);
    // A horizontal gradient brightening to the right sets every bit.
    const ramp = new Uint8Array(9 * 8).map((_, i) => (i % 9) * 20);
    expect(dHash(ramp, 9, 8)).toBe('ffffffffffffffff');
    expect(hamming('ffffffffffffffff', '0000000000000000')).toBe(64);
  });
});

describe('phaseShift', () => {
  it('finds a camera move between thumbnails, to a fraction of a pixel', () => {
    const base = texture(64, 0, 0);
    for (const [dx, dy] of [
      [3, 0],
      [-5, 2],
      [0, -4],
    ] as const) {
      const shift = phaseShift(base, texture(64, dx, dy), 64);
      expect(shift.dx).toBeCloseTo(dx, 0);
      expect(shift.dy).toBeCloseTo(dy, 0);
      expect(shift.peak).toBeGreaterThan(0.1);
    }
    const still = phaseShift(base, base, 64);
    expect(Math.abs(still.dx) + Math.abs(still.dy)).toBeLessThan(0.1);
  });

  it('downsamples by box filtering', () => {
    const data = new Uint8Array([0, 0, 100, 100, 0, 0, 100, 100]);
    expect(Array.from(downsample(data, 4, 2, 2))).toEqual([0, 100, 0, 100]);
  });
});
