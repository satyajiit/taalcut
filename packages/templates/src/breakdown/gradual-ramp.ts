// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The pixel measure behind gradual.ts (MATCH1): how much of one steady frame is still in the frames after it.
 *
 * Take a frame `r` whose picture has held for a few frames. The share of `r` in a later frame is the regression
 * coefficient of that frame on `r` (both with their means taken out). Through a blend into another picture the share
 * falls in a straight line from 1 to a floor (what the new picture happens to share with `r`) and stays there; at a
 * hard cut it drops in one frame; while a camera or a subject moves it drifts without arriving anywhere. A blend
 * also dims the picture's contrast on the way: the variance of a half-and-half frame is well under the line between
 * the two ends, which motion alone never does. A picture that only gets darker falls the same way, but it stays the
 * same picture: what it arrives at is still fully correlated with where it started.
 *
 * So a ramp is: a steady reference, shares that fit "a straight fall, then a plateau" within `fit`, a floor at or
 * under `floor`, at least `minBlended` frames on the way, no hard cut inside, the variance dip, and an end that is
 * either another picture (correlated with the reference by `floor` at most) or no picture at all (its pixels deviate
 * by less than `detail`: a fade's black or white). The references that see one ramp are clustered, and its ends are
 * read again from a reference just before it, where the reference's own drift is smallest. Pure: small gray frames
 * come in, frame numbers go out.
 *
 * What pixels can't tell: a picture that drifts while it dims by half reads like a blend into a darker picture.
 * That is why a ramp is a finding for the second method and the judge (gradual.ts), not a cut by itself.
 */
import type { BreakdownConfig } from './config';

export type GradualConfig = BreakdownConfig['gradual'];

/** A frame's mean and its sum of squares about the mean. */
interface FrameStats {
  readonly mean: number;
  readonly squares: number;
  readonly deviation: number;
}

/** The frames of one scan with what every test reads; `likeness` is each frame's correlation with the one before. */
export interface GrayScan {
  readonly frames: readonly Uint8Array[];
  readonly stats: readonly FrameStats[];
  readonly likeness: readonly number[];
}

/** One ramp, in the scan's own frame order. */
export interface Ramp {
  /** The last frame that is wholly the reference's picture, and the first that is wholly the other. */
  readonly from: number;
  readonly to: number;
  /** The first frame holding more of the new picture than the old. */
  readonly half: number;
  /** The frame at `to` has no picture in it (a fade's black or white, or nearly). */
  readonly empty: boolean;
}

function statsOf(frame: Uint8Array): FrameStats {
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i]!;
  const mean = frame.length === 0 ? 0 : sum / frame.length;
  let squares = 0;
  for (let i = 0; i < frame.length; i++) squares += (frame[i]! - mean) ** 2;
  return { mean, squares, deviation: frame.length === 0 ? 0 : Math.sqrt(squares / frame.length) };
}

function covariance(scan: GrayScan, a: number, b: number): number {
  const x = scan.frames[a]!;
  const y = scan.frames[b]!;
  const mx = scan.stats[a]!.mean;
  const my = scan.stats[b]!.mean;
  let sum = 0;
  for (let i = 0; i < x.length; i++) sum += (x[i]! - mx) * (y[i]! - my);
  return sum;
}

/** The share of frame `r`'s picture in frame `t`. */
function share(scan: GrayScan, t: number, r: number): number {
  const squares = scan.stats[r]!.squares;
  return squares === 0 ? 0 : covariance(scan, t, r) / squares;
}

export function grayScan(frames: readonly Uint8Array[]): GrayScan {
  const stats = frames.map(statsOf);
  const scan: GrayScan = { frames, stats, likeness: [] };
  const likeness = [1];
  for (let t = 1; t < frames.length; t++) {
    const scale = Math.sqrt(stats[t]!.squares * stats[t - 1]!.squares);
    likeness.push(scale === 0 ? 1 : covariance(scan, t, t - 1) / scale);
  }
  return { ...scan, likeness };
}

/** The same frames played backwards: a ramp into a steady picture is a ramp out of it, read from the other end. */
export function reversed(scan: GrayScan): GrayScan {
  const last = scan.frames.length - 1;
  return {
    frames: [...scan.frames].reverse(),
    stats: [...scan.stats].reverse(),
    // A frame's likeness to the one before it, backwards, is the next frame's forwards.
    likeness: scan.frames.map((_, index) => (index === 0 ? 1 : scan.likeness[last - index + 1]!)),
  };
}

/** A new picture starts at `t`: a frame unlike the one before, with a picture on both sides. */
function cutAt(scan: GrayScan, t: number, config: GradualConfig): boolean {
  const flat = (frame: number) => scan.stats[frame]!.deviation <= config.flat;
  return scan.likeness[t]! < config.cutLikeness && !flat(t) && !flat(t - 1);
}

/** Frame `r` has a picture, and the `steadyFrames` before it hold the same one. */
function steady(scan: GrayScan, r: number, config: GradualConfig): boolean {
  if (r < config.steadyFrames || scan.stats[r]!.deviation < config.detail) return false;
  for (let back = 1; back <= config.steadyFrames; back++) {
    if (cutAt(scan, r - back + 1, config)) return false;
    const held = share(scan, r - back, r);
    if (held < config.steadyShare || held > 1 / config.steadyShare) return false;
  }
  return true;
}

/** The share of `r` in each frame after it, up to `count` of them or the next cut; index 0 is `r` itself. */
function sharesFrom(scan: GrayScan, r: number, count: number, config: GradualConfig): number[] {
  const shares = [1];
  for (let k = 1; k <= count && r + k < scan.frames.length; k++) {
    if (cutAt(scan, r + k, config)) break;
    shares.push(share(scan, r + k, r));
  }
  return shares;
}

const mean = (values: readonly number[], from: number, to: number) => {
  let sum = 0;
  for (let i = from; i < to; i++) sum += values[i]!;
  return sum / Math.max(1, to - from);
};

/** The straight fall that fits the shares best, when one fits within `fit`: its length and the floor it reaches. */
function fall(shares: readonly number[], config: GradualConfig): { length: number; floor: number } | null {
  let best: { length: number; floor: number; error: number } | null = null;
  for (let length = config.minBlended + 1; length + config.plateau <= shares.length; length++) {
    const floor = mean(shares, length, length + config.plateau);
    if (floor > config.floor) continue;
    let error = 0;
    for (let k = 0; k < length + config.plateau; k++) {
      const model = k >= length ? floor : 1 - ((1 - floor) * k) / length;
      error = Math.max(error, Math.abs(shares[k]! - model));
    }
    if (error <= config.fit && (!best || error < best.error)) best = { length, floor, error };
  }
  return best;
}

/** The middle frames' variance as a share of the line between the ends' variances: a blend's dip. */
function dip(scan: GrayScan, r: number, length: number): number {
  const first = scan.stats[r]!.squares;
  const last = scan.stats[r + length]!.squares;
  const ratios: number[] = [];
  for (let k = 1; k < length; k++) {
    const alpha = k / length;
    if (alpha < 0.3 || alpha > 0.7) continue;
    ratios.push(scan.stats[r + k]!.squares / Math.max(1e-9, (1 - alpha) * first + alpha * last));
  }
  if (ratios.length === 0) return 1;
  ratios.sort((a, b) => a - b);
  return ratios[ratios.length >> 1]!;
}

/** The span a reference sees a ramp over, when it sees one. */
function seenFrom(scan: GrayScan, r: number, reach: number, config: GradualConfig) {
  if (!steady(scan, r, config)) return null;
  const fitted = fall(sharesFrom(scan, r, reach + config.plateau, config), config);
  if (!fitted || dip(scan, r, fitted.length) > config.dip) return null;
  // Where it arrives is another picture, or none: the same picture darker is not a transition.
  const end = r + fitted.length;
  const scale = Math.sqrt(scan.stats[r]!.squares * scan.stats[end]!.squares);
  const picture = scan.stats[end]!.deviation >= config.detail;
  if (picture && scale > 0 && covariance(scan, end, r) / scale > config.floor) return null;
  return { from: r, to: end };
}

/**
 * The ramp inside [low, high], read from a reference just before it. A line through the middle of the fall gives
 * its ends; a frame beside them that still holds `edge` of the other picture counts as blended.
 */
function refine(
  scan: GrayScan,
  low: number,
  high: number,
  reach: number,
  config: GradualConfig,
): Ramp | null {
  let reference = low;
  let end = high;
  for (let pass = 0; pass < 3; pass++) {
    const count = end - reference;
    const shares = sharesFrom(scan, reference, count + config.plateau, config);
    if (shares.length < count + 1) return null;
    const floor = mean(shares, count, Math.min(shares.length, count + config.plateau));
    if (floor >= 1) return null;
    const alpha = shares.map((held) => (1 - held) / (1 - floor));
    let n = 0;
    let sumK = 0;
    let sumA = 0;
    let sumKK = 0;
    let sumKA = 0;
    for (let k = 1; k < count; k++) {
      const a = alpha[k]!;
      if (a < 0.2 || a > 0.8) continue;
      n += 1;
      sumK += k;
      sumA += a;
      sumKK += k * k;
      sumKA += k * a;
    }
    if (n < 2) return null;
    const slope = (n * sumKA - sumK * sumA) / (n * sumKK - sumK * sumK);
    if (!(slope > 0)) return null;
    const start = sumK / n - sumA / n / slope;
    let first = Math.max(0, Math.floor(start + 0.25));
    let last = Math.min(shares.length - 1, Math.ceil(start + 1 / slope - 0.25));
    while (first > 0 && alpha[first]! >= config.edge) first -= 1;
    while (last < shares.length - 1 && alpha[last]! <= 1 - config.edge) last += 1;
    const from = reference + first;
    const to = reference + last;
    // Two frames before the ramp is as near as a reference gets without holding some of the new picture.
    const nearer = Math.max(config.steadyFrames, from - 1);
    if (pass < 2 && nearer !== reference && steady(scan, nearer, config)) {
      reference = nearer;
      end = Math.max(end, to);
      continue;
    }
    if (to - from > reach || to - from <= config.minBlended) return null;
    const half = alpha.findIndex((a, k) => k > first && a >= 0.5);
    return {
      from,
      to,
      half: half < 0 ? to : reference + half,
      empty: scan.stats[to]!.deviation < config.detail,
    };
  }
  return null;
}

/** Every ramp out of a steady picture in the scan, in order. `reach` is the longest a ramp may be, in frames. */
export function rampsIn(scan: GrayScan, reach: number, config: GradualConfig): Ramp[] {
  const clusters: { low: number; high: number }[] = [];
  const last = scan.frames.length - config.minBlended - 1;
  for (let r = config.steadyFrames; r < last; r++) {
    const seen = seenFrom(scan, r, reach, config);
    if (!seen) continue;
    const open = clusters[clusters.length - 1];
    if (open && seen.from < open.high) open.high = Math.max(open.high, seen.to);
    else clusters.push({ low: seen.from, high: seen.to });
  }
  return clusters.flatMap((cluster) => refine(scan, cluster.low, cluster.high, reach, config) ?? []);
}
