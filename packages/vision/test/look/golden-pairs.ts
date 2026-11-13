// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The ten generated golden pairs for the colour-match gate (SPEC P3.2), on the SPEC's 64×36 scoring grid.
 * Each "after" is the same picture as its "before" under a different grade. Do not edit a pair to make
 * the gate pass: the threshold and the pairs move only with the PO in front of them.
 */
import type { LookFrame } from '../../src/look/look-stats';

export const GRID_WIDTH = 64;
export const GRID_HEIGHT = 36;

function byte(value: number): number {
  if (value <= 0) return 0;
  if (value >= 255) return 255;
  return Math.round(value);
}

function image(fill: (u: number, v: number) => readonly [number, number, number]): LookFrame {
  const rgb = new Uint8Array(GRID_WIDTH * GRID_HEIGHT * 3);
  for (let y = 0; y < GRID_HEIGHT; y++) {
    const v = y / (GRID_HEIGHT - 1);
    for (let x = 0; x < GRID_WIDTH; x++) {
      const [r, g, b] = fill(x / (GRID_WIDTH - 1), v);
      const i = (y * GRID_WIDTH + x) * 3;
      rgb[i] = byte(r);
      rgb[i + 1] = byte(g);
      rgb[i + 2] = byte(b);
    }
  }
  return { width: GRID_WIDTH, height: GRID_HEIGHT, rgb, encoding: 'bt709' };
}

function hsv(h: number, s: number, v: number): readonly [number, number, number] {
  const chroma = v * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = chroma * (1 - Math.abs((hp % 2) - 1));
  const m = v - chroma;
  const sector: readonly (readonly [number, number, number])[] = [
    [chroma, x, 0],
    [x, chroma, 0],
    [0, chroma, x],
    [0, x, chroma],
    [x, 0, chroma],
    [chroma, 0, x],
  ];
  const [r, g, b] = sector[Math.min(5, Math.floor(hp))] ?? [0, 0, 0];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

export interface GoldenPair {
  readonly name: string;
  readonly before: LookFrame;
  readonly after: LookFrame;
}

export const GOLDEN_PAIRS: readonly GoldenPair[] = [
  {
    name: 'skin',
    before: image((u, v) => [188 + u * 40, 140 + v * 36, 114 + u * 16]),
    after: image((u, v) => [220 + u * 24, 126 + v * 28, 92 + u * 12]),
  },
  {
    name: 'sky',
    before: image((u, v) => [70 + u * 40, 140 + v * 30, 210 - v * 20]),
    after: image((u, v) => [36 + u * 24, 86 + v * 20, 176 - v * 16]),
  },
  {
    name: 'foliage',
    before: image((u, v) => [48 + u * 40, 130 + v * 50, 42 + u * 20]),
    after: image((u, v) => [36 + u * 20, 96 + v * 40, 30 + u * 10]),
  },
  {
    name: 'grey ramp',
    before: image((u) => [18 + u * 220, 18 + u * 220, 18 + u * 220]),
    after: image((u) => [8 + u * 240, 8 + u * 240, 8 + u * 240]),
  },
  {
    name: 'saturated',
    before: image((u, v) => hsv(u * 330, 0.75 + v * 0.2, 0.45 + v * 0.5)),
    after: image((u, v) => hsv(u * 330 + 28, 0.85, 0.4 + v * 0.5)),
  },
  {
    name: 'dark',
    before: image((u, v) => [16 + u * 40, 14 + v * 28, 18 + u * 22]),
    after: image((u, v) => [28 + u * 50, 24 + v * 36, 22 + u * 24]),
  },
  {
    name: 'teal-orange',
    before: image((u, v) => [40 + u * 180, 120 - u * 40 + v * 20, 150 - u * 80]),
    after: image((u, v) => [80 + u * 150, 90 - u * 20 + v * 16, 70 - u * 20]),
  },
  {
    name: 'pastel',
    before: image((u, v) => [210 + u * 30, 200 + v * 20, 220 - u * 15]),
    after: image((u, v) => [236 + u * 12, 214 + v * 16, 206 - u * 10]),
  },
  {
    name: 'tungsten',
    before: image((u, v) => [200 + u * 30, 150 + v * 20, 90 + u * 20]),
    after: image((u, v) => [170 + u * 30, 176 + v * 24, 190 + u * 20]),
  },
  {
    name: 'chart',
    before: image((u, v) => hsv(u * 300, 0.35 + v * 0.55, 0.3 + (1 - v) * 0.6)),
    after: image((u, v) => hsv(u * 300 - 18, 0.5 + v * 0.4, 0.35 + (1 - v) * 0.55)),
  },
];

/** Packed 8-bit R′G′B′ as 0–1 floats, the form meanDeltaE scores. */
export function unitRgb(frame: LookFrame): Float64Array {
  return Float64Array.from(frame.rgb, (code) => code / 255);
}
