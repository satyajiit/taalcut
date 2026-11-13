// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A similarity transform (shift, scale and rotation: four numbers) fitted to tracked points (FRM1-MOT): RANSAC on
 * two-point samples, then a least-squares refit on the inliers, twice. Points are relative to the frame's centre, so
 * the shift is the centre's and the scale and rotation are about it. Seeded: the same points give the same fit.
 *
 * The model maps a point p in A to q in B as q = (a·px − b·py + tx, b·px + a·py + ty): scale √(a² + b²), rotation
 * atan2(b, a) (clockwise on screen, y pointing down).
 */
import type { Track } from './klt';

export interface Similarity {
  readonly a: number;
  readonly b: number;
  readonly tx: number;
  readonly ty: number;
}

export interface Fit {
  readonly model: Similarity;
  /** Indices of the points within the inlier distance. */
  readonly inliers: number[];
  /** Root-mean-square distance of the inliers from the model, pixels. */
  readonly residual: number;
}

export const IDENTITY: Similarity = { a: 1, b: 0, tx: 0, ty: 0 };

export interface Point {
  readonly x: number;
  readonly y: number;
  readonly tx: number;
  readonly ty: number;
}

/** Tracks relative to the frame's centre (cx, cy). */
export function centred(tracks: readonly Track[], cx: number, cy: number): Point[] {
  return tracks.map((t) => ({ x: t.x - cx, y: t.y - cy, tx: t.tx - cx, ty: t.ty - cy }));
}

export function errorOf(model: Similarity, p: Point): number {
  const qx = model.a * p.x - model.b * p.y + model.tx;
  const qy = model.b * p.x + model.a * p.y + model.ty;
  return Math.hypot(qx - p.tx, qy - p.ty);
}

/** The model through two points; null when they coincide. */
function fromTwo(p: Point, q: Point): Similarity | null {
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const ex = q.tx - p.tx;
  const ey = q.ty - p.ty;
  const norm = dx * dx + dy * dy;
  if (norm < 4) return null;
  // (ex + i·ey) / (dx + i·dy)
  const a = (ex * dx + ey * dy) / norm;
  const b = (ey * dx - ex * dy) / norm;
  return { a, b, tx: p.tx - (a * p.x - b * p.y), ty: p.ty - (b * p.x + a * p.y) };
}

/** Least squares over the points (all of them, or those at `use`). */
export function leastSquares(points: readonly Point[], use?: readonly number[]): Similarity | null {
  const chosen = use ? use.map((i) => points[i]!) : points;
  if (chosen.length < 2) return null;
  let mx = 0;
  let my = 0;
  let nx = 0;
  let ny = 0;
  for (const p of chosen) {
    mx += p.x;
    my += p.y;
    nx += p.tx;
    ny += p.ty;
  }
  mx /= chosen.length;
  my /= chosen.length;
  nx /= chosen.length;
  ny /= chosen.length;
  let dot = 0;
  let cross = 0;
  let norm = 0;
  for (const p of chosen) {
    const px = p.x - mx;
    const py = p.y - my;
    const qx = p.tx - nx;
    const qy = p.ty - ny;
    dot += px * qx + py * qy;
    cross += px * qy - py * qx;
    norm += px * px + py * py;
  }
  if (norm < 1e-9) return { a: 1, b: 0, tx: nx - mx, ty: ny - my };
  const a = dot / norm;
  const b = cross / norm;
  return { a, b, tx: nx - (a * mx - b * my), ty: ny - (b * mx + a * my) };
}

/** mulberry32. */
function random(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function inliersOf(model: Similarity, points: readonly Point[], threshold: number): number[] {
  const out: number[] = [];
  points.forEach((p, i) => {
    if (errorOf(model, p) <= threshold) out.push(i);
  });
  return out;
}

/**
 * RANSAC over two-point samples (`iterations` of them), then two least-squares refits on the inliers. A plain
 * scale outside [0.5, 2] or a turn over 0.5 rad between two samples is no camera move and is never chosen. Null with
 * fewer than `minInliers` agreeing.
 */
export function ransacSimilarity(
  points: readonly Point[],
  options: {
    readonly threshold: number;
    readonly iterations: number;
    readonly minInliers: number;
    readonly seed: number;
  },
): Fit | null {
  if (points.length < Math.max(2, options.minInliers)) return null;
  const rng = random(options.seed);
  let best: number[] = [];
  let bestCost = Infinity;
  const n = points.length;
  for (let k = 0; k < options.iterations; k++) {
    const i = Math.floor(rng() * n);
    let j = Math.floor(rng() * (n - 1));
    if (j >= i) j += 1;
    const model = fromTwo(points[i]!, points[j]!);
    if (!model) continue;
    const scale = Math.hypot(model.a, model.b);
    if (scale < 0.5 || scale > 2 || Math.abs(Math.atan2(model.b, model.a)) > 0.5) continue;
    // MSAC: an inlier costs its squared error, an outlier the threshold's.
    let cost = 0;
    const t2 = options.threshold * options.threshold;
    const inliers: number[] = [];
    for (let m = 0; m < n; m++) {
      const e = errorOf(model, points[m]!);
      if (e <= options.threshold) {
        cost += e * e;
        inliers.push(m);
      } else cost += t2;
    }
    if (cost < bestCost) {
      bestCost = cost;
      best = inliers;
    }
  }
  if (best.length < options.minInliers) return null;
  let model = leastSquares(points, best);
  if (!model) return null;
  let inliers = best;
  for (let refit = 0; refit < 2; refit++) {
    const next = inliersOf(model, points, options.threshold);
    if (next.length < options.minInliers) break;
    const again = leastSquares(points, next);
    if (!again) break;
    model = again;
    inliers = next;
  }
  let squares = 0;
  for (const i of inliers) squares += errorOf(model, points[i]!) ** 2;
  return { model, inliers, residual: Math.sqrt(squares / Math.max(1, inliers.length)) };
}
