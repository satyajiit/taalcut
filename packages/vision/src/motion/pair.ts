// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The camera's move between two frames (FRM1-MOT): corners spread over frame A, tracked into B with a
 * forward–backward check, and a similarity fitted to the background by RANSAC.
 *
 * The subject is kept out of the fit. With subject boxes (a tracker's faces and people), points inside them are the
 * subject's, and the rest are the background. Without boxes, the points are split into the two motions they show
 * (two RANSAC layers); the background is the layer spread over more of the frame, its edges above all, since a
 * subject is one compact thing. Either way the subject's own move in the frame comes back too: a tracking shot is
 * the background moving while the subject holds still.
 */
import { phaseShift, downsample } from '../quality/shift';
import { gridCorners, type Level } from './image';
import { trackPoints, type Track } from './klt';
import {
  centred,
  errorOf,
  IDENTITY,
  ransacSimilarity,
  type Fit,
  type Point,
  type Similarity,
} from './similarity';
import { MOTION_CONFIG } from './config';

/** A box as shares of the frame, top left. */
export interface ShareBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface PairMotion {
  /** The background's shift from A to B at the frame's centre: frame widths (right +) and heights (down +). */
  readonly dx: number;
  readonly dy: number;
  /** Log of its scale (the picture grows: +). */
  readonly scale: number;
  /** Its turn in radians (clockwise on screen: +). */
  readonly rotation: number;
  /** Share of the tracked points the background fit holds. */
  readonly inliers: number;
  /** Points tracked both ways. */
  readonly points: number;
  /** RMS distance of its inliers from the fit, as a share of the long side. */
  readonly residual: number;
  /** The subject's own shift in the frame (frame widths and heights), when one was seen; null otherwise. */
  readonly subject: { readonly dx: number; readonly dy: number } | null;
}

const c = MOTION_CONFIG.estimator;

function inside(
  boxes: readonly ShareBox[],
  x: number,
  y: number,
  width: number,
  height: number,
  grow: number,
) {
  const u = x / width;
  const v = y / height;
  return boxes.some(
    (b) =>
      u >= b.x - grow * b.width &&
      u <= b.x + b.width * (1 + grow) &&
      v >= b.y - grow * b.height &&
      v <= b.y + b.height * (1 + grow),
  );
}

/** How much of the frame a set of points covers: cells of a 6×6 grid, the outer ring counting double. */
export function spread(points: readonly Point[], width: number, height: number): number {
  const cells = new Set<number>();
  for (const p of points) {
    const cx = Math.min(5, Math.max(0, Math.floor(((p.x + width / 2) * 6) / width)));
    const cy = Math.min(5, Math.max(0, Math.floor(((p.y + height / 2) * 6) / height)));
    cells.add(cy * 6 + cx);
  }
  let score = 0;
  for (const cell of cells) {
    const x = cell % 6;
    const y = Math.floor(cell / 6);
    score += x === 0 || y === 0 || x === 5 || y === 5 ? 2 : 1;
  }
  return score / 56;
}

/** The largest shift between two models over the frame's corners and centre, pixels. */
function apart(m: Similarity, n: Similarity, width: number, height: number): number {
  let most = 0;
  for (const [x, y] of [
    [0, 0],
    [-width / 2, -height / 2],
    [width / 2, -height / 2],
    [-width / 2, height / 2],
    [width / 2, height / 2],
  ] as const) {
    const qm = { x: m.a * x - m.b * y + m.tx, y: m.b * x + m.a * y + m.ty };
    const qn = { x: n.a * x - n.b * y + n.tx, y: n.b * x + n.a * y + n.ty };
    most = Math.max(most, Math.hypot(qm.x - qn.x, qm.y - qn.y));
  }
  return most;
}

const median = (values: number[]) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

function fitOf(points: readonly Point[], threshold: number, seed: number, minInliers: number): Fit | null {
  return ransacSimilarity(points, { threshold, iterations: c.ransacIterations, minInliers, seed });
}

/** The background and the subject's motion from the tracked points. */
function separate(
  tracks: readonly Track[],
  base: Level,
  boxes: readonly ShareBox[] | undefined,
  seed: number,
): { background: Fit; points: Point[]; subject: PairMotion['subject'] } | null {
  const { width, height } = base;
  const points = centred(tracks, width / 2, height / 2);
  const threshold = c.inlierPixels * (Math.max(width, height) / 384);
  const minimum = Math.max(c.minInliers, Math.round(points.length * 0.1));
  const shift = (ps: readonly Point[]) => ({
    dx: median(ps.map((p) => p.tx - p.x)) / width,
    dy: median(ps.map((p) => p.ty - p.y)) / height,
  });
  if (boxes && boxes.length > 0) {
    const mine = points.filter((p) =>
      inside(boxes, p.x + width / 2, p.y + height / 2, width, height, c.boxGrow),
    );
    const rest = points.filter((p) => !mine.includes(p));
    if (rest.length >= c.minInliers) {
      const background = fitOf(rest, threshold, seed, Math.max(c.minInliers, Math.round(rest.length * 0.1)));
      if (background) {
        // The subject's own points are the ones in its box that don't move with the background; a box whose points
        // all do holds something that moves as the background does.
        const own = mine.filter((p) => errorOf(background.model, p) > threshold);
        return {
          background: { ...background, inliers: background.inliers.map((i) => points.indexOf(rest[i]!)) },
          points,
          subject:
            own.length >= c.minSubjectPoints
              ? shift(own)
              : mine.length >= c.minSubjectPoints
                ? shift(mine)
                : null,
        };
      }
    }
  }
  const first = fitOf(points, threshold, seed, minimum);
  if (!first) return null;
  const held = new Set(first.inliers);
  const outliers = points.filter((_, i) => !held.has(i));
  if (outliers.length < Math.max(c.minSubjectPoints, points.length * c.layerShare))
    return { background: first, points, subject: null };
  const second = fitOf(
    outliers,
    threshold,
    seed + 7,
    Math.max(c.minSubjectPoints, Math.round(points.length * c.layerShare)),
  );
  if (!second || apart(first.model, second.model, width, height) < 2 * threshold)
    return { background: first, points, subject: null };
  const layer2 = second.inliers.map((i) => outliers[i]!);
  const layer1 = first.inliers.map((i) => points[i]!);
  const still = (m: Similarity) => apart(m, IDENTITY, width, height) < 2 * threshold;
  const spread1 = spread(layer1, width, height);
  const spread2 = spread(layer2, width, height);
  const firstIsBackground =
    still(first.model) !== still(second.model)
      ? still(first.model)
        ? spread1 >= spread2 * c.stillBias
        : spread2 < spread1 * c.stillBias
      : spread1 >= spread2 * c.spreadRatio;
  if (firstIsBackground) return { background: first, points, subject: shift(layer2) };
  const indices = layer2.map((p) => points.indexOf(p));
  return { background: { ...second, inliers: indices }, points, subject: shift(layer1) };
}

/** A shift guess for the tracker from phase correlation on 64×64 squashed copies, in level-0 pixels. */
function phaseGuess(a: Level, b: Level): { dx: number; dy: number } {
  const size = 64;
  const shift = phaseShift(
    downsample(Uint8Array.from(a.data), a.width, a.height, size),
    downsample(Uint8Array.from(b.data), b.width, b.height, size),
    size,
  );
  return { dx: (shift.dx * a.width) / size, dy: (shift.dy * a.height) / size };
}

/**
 * The background's move from A to B (each a pyramid of the same frame size); null when nothing could be tracked
 * (a flat or black frame, a cut). `boxes`: the subject's boxes in A; `ignore`: areas to leave out (captions).
 */
export function pairMotion(
  a: readonly Level[],
  b: readonly Level[],
  options: {
    readonly boxes?: readonly ShareBox[];
    readonly ignore?: readonly ShareBox[];
    readonly seed: number;
  },
): PairMotion | null {
  const base = a[0]!;
  const { width, height } = base;
  const long = Math.max(width, height);
  const cell = long / c.cellsOnLongSide;
  const ignore = options.ignore ?? [];
  const corners = gridCorners(base, {
    columns: Math.max(4, Math.round(width / cell)),
    rows: Math.max(4, Math.round(height / cell)),
    relative: c.cornerRelative,
    floor: c.cornerFloor,
    border: c.radius + 2,
    ...(ignore.length > 0 ? { skip: (x: number, y: number) => inside(ignore, x, y, width, height, 0) } : {}),
  });
  if (corners.length < c.minInliers) return null;
  const klt = { radius: c.radius, iterations: c.iterations, maxError: c.forwardBackward * (long / 384) };
  let tracks = trackPoints(a, b, corners, { dx: 0, dy: 0 }, klt);
  let found = separate(tracks, base, options.boxes, options.seed);
  if (!found || found.background.inliers.length < corners.length * c.retryBelow) {
    // A fast move: start every point from the whole picture's shift and keep whichever holds more points.
    const guess = phaseGuess(base, b[0]!);
    if (Math.hypot(guess.dx, guess.dy) > 2) {
      const again = trackPoints(a, b, corners, guess, klt);
      const second = separate(again, base, options.boxes, options.seed);
      if (second && (!found || second.background.inliers.length > found.background.inliers.length)) {
        found = second;
        tracks = again;
      }
    }
  }
  if (!found) return null;
  const { model } = found.background;
  return {
    dx: model.tx / width,
    dy: model.ty / height,
    scale: Math.log(Math.hypot(model.a, model.b)),
    rotation: Math.atan2(model.b, model.a),
    inliers: found.background.inliers.length / Math.max(1, tracks.length),
    points: tracks.length,
    residual: found.background.residual / long,
    subject: found.subject,
  };
}
