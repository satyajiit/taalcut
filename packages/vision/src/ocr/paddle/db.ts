// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * DB post-processing for the PP-OCRv5 detector (inference.yml `DBPostProcess`:
 * thresh 0.3, box_thresh 0.6, unclip_ratio 1.5, max_candidates 1000). The
 * probability map is binarised, connected regions become axis-aligned boxes
 * scored by their mean probability, and each box grows by the unclip distance
 * (area × ratio / perimeter). Paddle fits rotated rectangles; on-screen text
 * in reels is horizontal, so axis-aligned boxes lose nothing (spike 05).
 */

export const DB_THRESH = 0.3;
export const DB_BOX_THRESH = 0.6;
export const DB_UNCLIP_RATIO = 1.5;
export const DB_MAX_CANDIDATES = 1000;
/** Specks smaller than this many pixels on the map are noise, not text. */
const MIN_REGION_PIXELS = 8;

/** A box in frame pixels. */
export interface PixelBox {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly score: number;
}

export interface ProbabilityMap {
  readonly data: Float32Array;
  readonly width: number;
  readonly height: number;
}

function sigmoid(v: number): number {
  return v >= 0 ? 1 / (1 + Math.exp(-v)) : Math.exp(v) / (1 + Math.exp(v));
}

/** Probabilities in [0, 1]: a map outside that range is logits, as some exports leave them. */
function probabilities(map: Float32Array): Float32Array {
  let min = Infinity;
  let max = -Infinity;
  for (const v of map) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (min >= -0.01 && max <= 1.01) return map;
  return map.map(sigmoid);
}

interface Region {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  count: number;
}

/** Labels 4-connected regions above the threshold (two-pass union-find). */
function regions(prob: Float32Array, width: number, height: number): Region[] {
  const labels = new Int32Array(width * height);
  const parent: number[] = [0];
  const find = (a: number): number => {
    let root = a;
    while (parent[root] !== root) root = parent[root] ?? root;
    while (parent[a] !== root) {
      const next = parent[a] ?? root;
      parent[a] = root;
      a = next;
    }
    return root;
  };
  let next = 1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if ((prob[i] ?? 0) <= DB_THRESH) continue;
      const left = x > 0 ? (labels[i - 1] ?? 0) : 0;
      const up = y > 0 ? (labels[i - width] ?? 0) : 0;
      if (left && up) {
        labels[i] = left;
        const a = find(left);
        const b = find(up);
        if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
      } else if (left || up) {
        labels[i] = left || up;
      } else {
        labels[i] = next;
        parent[next] = next;
        next++;
      }
    }
  }
  const byRoot = new Map<number, Region>();
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i] ?? 0;
    if (!label) continue;
    const root = find(label);
    const x = i % width;
    const y = Math.floor(i / width);
    const region = byRoot.get(root);
    if (!region) {
      byRoot.set(root, { minX: x, minY: y, maxX: x, maxY: y, count: 1 });
      continue;
    }
    region.minX = Math.min(region.minX, x);
    region.minY = Math.min(region.minY, y);
    region.maxX = Math.max(region.maxX, x);
    region.maxY = Math.max(region.maxY, y);
    region.count++;
  }
  return [...byRoot.values()];
}

/**
 * Text boxes from the detector's map, in the original frame's pixels, top to
 * bottom. `frameWidth`/`frameHeight` scale the map back to the frame.
 */
export function dbBoxes(map: ProbabilityMap, frameWidth: number, frameHeight: number): PixelBox[] {
  const prob = probabilities(map.data);
  const sx = frameWidth / map.width;
  const sy = frameHeight / map.height;
  const boxes: PixelBox[] = [];
  const found = regions(prob, map.width, map.height)
    .filter((region) => region.count >= MIN_REGION_PIXELS)
    .sort((a, b) => b.count - a.count)
    .slice(0, DB_MAX_CANDIDATES);
  for (const region of found) {
    let sum = 0;
    let n = 0;
    for (let y = region.minY; y <= region.maxY; y++) {
      for (let x = region.minX; x <= region.maxX; x++) {
        sum += prob[y * map.width + x] ?? 0;
        n++;
      }
    }
    const score = n > 0 ? sum / n : 0;
    if (score < DB_BOX_THRESH) continue;
    const w = region.maxX - region.minX + 1;
    const h = region.maxY - region.minY + 1;
    const grow = (w * h * DB_UNCLIP_RATIO) / (2 * (w + h));
    boxes.push({
      x0: Math.max(0, (region.minX - grow) * sx),
      y0: Math.max(0, (region.minY - grow) * sy),
      x1: Math.min(frameWidth, (region.maxX + 1 + grow) * sx),
      y1: Math.min(frameHeight, (region.maxY + 1 + grow) * sy),
      score,
    });
  }
  return boxes.sort((a, b) => (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2 || a.x0 - b.x0);
}

/**
 * Joins boxes that sit on one line (vertical centres within half a height and
 * a horizontal gap under 1.5 heights): the detector often splits a Devanagari
 * line at word gaps, and the recogniser reads a whole line better.
 */
export function mergeLines(boxes: readonly PixelBox[]): PixelBox[] {
  const lines: PixelBox[] = [];
  for (const box of [...boxes].sort((a, b) => a.x0 - b.x0)) {
    const mid = (box.y0 + box.y1) / 2;
    const height = Math.max(box.y1 - box.y0, 1);
    const index = lines.findIndex((line) => {
      const lineHeight = Math.max(line.y1 - line.y0, 1);
      const sameRow = Math.abs(mid - (line.y0 + line.y1) / 2) <= 0.5 * Math.max(height, lineHeight);
      const gap = box.x0 - line.x1;
      return sameRow && gap <= 1.5 * Math.max(height, lineHeight);
    });
    const line = lines[index];
    if (!line) {
      lines.push(box);
      continue;
    }
    lines[index] = {
      x0: Math.min(line.x0, box.x0),
      y0: Math.min(line.y0, box.y0),
      x1: Math.max(line.x1, box.x1),
      y1: Math.max(line.y1, box.y1),
      score: Math.min(line.score, box.score),
    };
  }
  return lines.sort((a, b) => (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2);
}
