// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Pyramidal Lucas–Kanade point tracking (FRM1-MOT), with a forward–backward check: each point is tracked from frame
 * A to frame B, then back from where it landed; a point that doesn't come home within `maxError` pixels was lost
 * (occluded, on a repeating pattern, at a moving edge) and is dropped. The window and its gradients are read from A
 * once per level; only B is sampled while iterating.
 */
import { sample, type Level } from './image';

export interface Track {
  readonly x: number;
  readonly y: number;
  /** Where the point is in B, at level-0 pixels. */
  readonly tx: number;
  readonly ty: number;
}

export interface KltOptions {
  /** Window radius at every level (7: 15×15). */
  readonly radius: number;
  readonly iterations: number;
  /** A point whose return lands further than this from where it started (level-0 pixels) is dropped. */
  readonly maxError: number;
}

/** One point from `from` to `to`, starting at `guess` (level-0 displacement); null when the window has no texture. */
function trackPoint(
  from: readonly Level[],
  to: readonly Level[],
  x: number,
  y: number,
  guess: { dx: number; dy: number },
  options: KltOptions,
): { x: number; y: number } | null {
  const r = options.radius;
  const size = (2 * r + 1) * (2 * r + 1);
  const window = new Float32Array(size);
  const wx = new Float32Array(size);
  const wy = new Float32Array(size);
  const top = from.length - 1;
  let gx = guess.dx / 2 ** top;
  let gy = guess.dy / 2 ** top;
  for (let level = top; level >= 0; level--) {
    const a = from[level]!;
    const b = to[level]!;
    const px = x / 2 ** level;
    const py = y / 2 ** level;
    let k = 0;
    let gxx = 0;
    let gxy = 0;
    let gyy = 0;
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        const ix = sample(a.gx, a.width, a.height, px + dx, py + dy);
        const iy = sample(a.gy, a.width, a.height, px + dx, py + dy);
        window[k] = sample(a.data, a.width, a.height, px + dx, py + dy);
        wx[k] = ix;
        wy[k] = iy;
        gxx += ix * ix;
        gxy += ix * iy;
        gyy += iy * iy;
        k++;
      }
    const det = gxx * gyy - gxy * gxy;
    if (det < 1e-6 * size * size) return null;
    let vx = 0;
    let vy = 0;
    for (let iteration = 0; iteration < options.iterations; iteration++) {
      let bx = 0;
      let by = 0;
      k = 0;
      const ox = px + gx + vx;
      const oy = py + gy + vy;
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          const diff = (window[k] as number) - sample(b.data, b.width, b.height, ox + dx, oy + dy);
          bx += diff * (wx[k] as number);
          by += diff * (wy[k] as number);
          k++;
        }
      const stepX = (gyy * bx - gxy * by) / det;
      const stepY = (gxx * by - gxy * bx) / det;
      vx += stepX;
      vy += stepY;
      if (stepX * stepX + stepY * stepY < 1e-4) break;
    }
    if (level > 0) {
      gx = 2 * (gx + vx);
      gy = 2 * (gy + vy);
    } else {
      gx += vx;
      gy += vy;
    }
  }
  const tx = x + gx;
  const ty = y + gy;
  const base = to[0]!;
  if (!Number.isFinite(tx) || !Number.isFinite(ty)) return null;
  if (tx < 0 || ty < 0 || tx > base.width - 1 || ty > base.height - 1) return null;
  return { x: tx, y: ty };
}

/** The points tracked from A to B that pass the forward–backward check. */
export function trackPoints(
  a: readonly Level[],
  b: readonly Level[],
  points: readonly { readonly x: number; readonly y: number }[],
  guess: { dx: number; dy: number },
  options: KltOptions,
): Track[] {
  const out: Track[] = [];
  for (const point of points) {
    const forward = trackPoint(a, b, point.x, point.y, guess, options);
    if (!forward) continue;
    const back = trackPoint(
      b,
      a,
      forward.x,
      forward.y,
      { dx: point.x - forward.x, dy: point.y - forward.y },
      options,
    );
    if (!back) continue;
    const error = Math.hypot(back.x - point.x, back.y - point.y);
    if (error <= options.maxError) out.push({ x: point.x, y: point.y, tx: forward.x, ty: forward.y });
  }
  return out;
}
