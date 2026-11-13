// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A shot's camera move from its frame pairs (FRM1-MOT): the measured numbers, a primary label and a confidence.
 *
 * - **pan, tilt:** the camera's net shift along one axis, in long sides a second (pixels compare across axes);
 * - **push-in, pull-out:** its net change of scale, as the speed it moves the frame's corners;
 * - **tracking:** the background moves while the subject holds still in the frame;
 * - **handheld:** shake left once the path's slow part is taken out (a local straight line over ±0.3 s), with no
 *   sustained move;
 * - **static:** everything under the lines, however much a subject moves (its points are kept out of the fit).
 *
 * The numbers are the camera's: pan positive to the right, tilt positive down, scale positive in, rotation positive
 * clockwise. Thresholds are MOTION_CONFIG.classifier's.
 */
import type { CameraMotion } from '@taalcut/core';
import { MOTION_CONFIG } from './config';
import type { PairMotion } from './pair';

export interface MotionPair {
  /** Grid frame of the later frame of the pair. */
  readonly frame: number;
  /** Seconds between the two frames. */
  readonly seconds: number;
  /** Null when the pair couldn't be measured (a flat frame, nothing tracked). */
  readonly motion: PairMotion | null;
}

export interface ShotMeasure {
  /** Frame widths a second, the camera panning right: +. */
  readonly panX: number;
  /** Frame heights a second, tilting down: +. */
  readonly panY: number;
  /** Log-scale a second, pushing in: +. */
  readonly scale: number;
  /** Radians a second, rolling clockwise: +. */
  readonly rotation: number;
  /** Shake: RMS distance from the slow path, as a share of the frame's long side. */
  readonly jitter: number;
  /** The subject holds still in the frame while the background moves; absent when no subject was seen. */
  readonly subjectSteady?: boolean;
  /** The best label, unsure or not; null when nothing was measured. */
  readonly label: CameraMotion | null;
  /** 0–1: how sure the label is (the measure's quality times how clearly it is past its lines). */
  readonly confidence: number;
}

export interface ShotFeatures {
  readonly seconds: number;
  readonly coverage: number;
  readonly inliers: number;
  /** Long sides a second. */
  readonly pan: number;
  readonly tilt: number;
  /** Corner speed of the zoom, long sides a second. */
  readonly zoom: number;
  readonly jitter: number;
  /** The subject's net speed in the frame (long sides a second) and the share of pairs it was seen in. */
  readonly subjectSpeed: number | null;
  readonly subjectSeen: number;
}

export type MotionThresholds = { readonly [K in keyof (typeof MOTION_CONFIG)['classifier']]: number };
type Thresholds = MotionThresholds;
const clamp01 = (x: number) => Math.min(1, Math.max(0, Number.isFinite(x) ? x : 0));

/** Residual of each point from a straight line through its neighbours within `half` seconds (or all of them). */
function shake(times: readonly number[], values: readonly number[], half: number): number[] {
  return values.map((value, k) => {
    const near: number[] = [];
    for (let i = 0; i < values.length; i++) if (Math.abs(times[i]! - times[k]!) <= half) near.push(i);
    if (near.length < 3) return 0;
    let mt = 0;
    let mv = 0;
    for (const i of near) {
      mt += times[i]!;
      mv += values[i]!;
    }
    mt /= near.length;
    mv /= near.length;
    let cov = 0;
    let vt = 0;
    for (const i of near) {
      cov += (times[i]! - mt) * (values[i]! - mv);
      vt += (times[i]! - mt) ** 2;
    }
    const slope = vt > 0 ? cov / vt : 0;
    return value - (mv + slope * (times[k]! - mt));
  });
}

/** The features the label is decided on. */
export function shotFeatures(
  pairs: readonly MotionPair[],
  frame: { width: number; height: number },
): ShotFeatures {
  const long = Math.max(frame.width, frame.height);
  const wide = frame.width / long;
  const tall = frame.height / long;
  const corner = Math.hypot(frame.width, frame.height) / 2 / long;
  const valid = pairs.filter((p): p is MotionPair & { motion: PairMotion } => p.motion !== null);
  const seconds = valid.reduce((sum, p) => sum + p.seconds, 0);
  if (valid.length === 0 || seconds <= 0)
    return {
      seconds: 0,
      coverage: 0,
      inliers: 0,
      pan: 0,
      tilt: 0,
      zoom: 0,
      jitter: 0,
      subjectSpeed: null,
      subjectSeen: 0,
    };
  let x = 0;
  let y = 0;
  let s = 0;
  let r = 0;
  const times: number[] = [0];
  const paths = { x: [0], y: [0], s: [0], r: [0] };
  let t = 0;
  for (const pair of valid) {
    const m = pair.motion;
    x -= m.dx * wide;
    y -= m.dy * tall;
    s += m.scale;
    r -= m.rotation;
    t += pair.seconds;
    times.push(t);
    paths.x.push(x);
    paths.y.push(y);
    paths.s.push(s * corner);
    paths.r.push(r * corner);
  }
  const half = seconds < 0.8 ? Infinity : 0.3;
  const residuals = (['x', 'y', 's', 'r'] as const).map((axis) => shake(times, paths[axis], half));
  let squares = 0;
  for (let k = 0; k < times.length; k++) for (const axis of residuals) squares += axis[k]! ** 2;
  const seen = valid.filter((p) => p.motion.subject !== null);
  let sx = 0;
  let sy = 0;
  let seenSeconds = 0;
  for (const p of seen) {
    sx += p.motion.subject!.dx * wide;
    sy += p.motion.subject!.dy * tall;
    seenSeconds += p.seconds;
  }
  return {
    seconds,
    coverage: valid.length / pairs.length,
    inliers: valid.reduce((sum, p) => sum + p.motion.inliers, 0) / valid.length,
    pan: Math.abs(x) / seconds,
    tilt: Math.abs(y) / seconds,
    zoom: (Math.abs(s) * corner) / seconds,
    jitter: Math.sqrt(squares / times.length),
    subjectSpeed: seen.length > 0 ? Math.hypot(sx, sy) / seenSeconds : null,
    subjectSeen: seen.length / valid.length,
  };
}

/** How far `value` is past `line`, 0 at the line and 1 at `factor` times (or a 1/factor-th) of it. */
function margin(value: number, line: number, factor: number): number {
  if (line <= 0) return 1;
  const ratio = value / line;
  return ratio >= 1
    ? clamp01((ratio - 1) / (factor - 1))
    : clamp01((1 / Math.max(ratio, 1e-9) - 1) / (factor - 1));
}

/** The label for a shot's features (`scaleSign`: the sign of its net zoom), how clearly, and whether its subject held still. */
export function decideMotion(
  f: ShotFeatures,
  scaleSign: number,
  thresholds: Thresholds = MOTION_CONFIG.classifier,
): { label: CameraMotion; clearly: number; steady: boolean | undefined } {
  const shift = Math.hypot(f.pan, f.tilt);
  const speed = Math.max(shift, f.zoom);
  const travel = speed * f.seconds;
  // A sustained move stands out from the shake: a strong hand drifts a little over a short shot too.
  const moving =
    speed >= thresholds.moveSpeed &&
    travel >= thresholds.minTravel &&
    travel >= thresholds.shakeRatio * f.jitter;
  const seen = f.subjectSpeed !== null && f.subjectSeen >= 0.5;
  const holds =
    seen && f.subjectSpeed! <= thresholds.steadySpeed && f.subjectSpeed! <= thresholds.steadyShare * speed;
  // Following: a subject that keeps its place (a walker's drift allowed) while the background moves at all is the
  // camera moving with it. A walk behind someone barely moves the far background, so a lower line than a pan's.
  const following =
    !moving &&
    seen &&
    f.subjectSpeed! <= thresholds.followSubject &&
    speed >= thresholds.followSpeed &&
    travel >= thresholds.followShake * f.jitter;
  const steady = seen ? (moving && holds) || following : undefined;
  // How clearly the camera moves or doesn't: by the line it passes least (moving), or misses most (not moving).
  const lines = [
    margin(speed, thresholds.moveSpeed, 2),
    margin(travel, thresholds.minTravel, 2),
    margin(travel, thresholds.shakeRatio * f.jitter, 2),
  ];
  const missed = [
    speed < thresholds.moveSpeed,
    travel < thresholds.minTravel,
    travel < thresholds.shakeRatio * f.jitter,
  ];
  const still = Math.max(...lines.filter((_, i) => missed[i]), 0);
  if (!moving && !following) {
    const label = f.jitter >= thresholds.jitter ? 'handheld' : 'static';
    return { label, clearly: Math.min(still, margin(f.jitter, thresholds.jitter, 2)), steady };
  }
  if (!moving) {
    return {
      label: 'tracking',
      clearly: Math.min(
        margin(speed, thresholds.followSpeed, 2),
        margin(f.subjectSpeed!, thresholds.followSubject, 2),
      ),
      steady,
    };
  }
  let label: CameraMotion;
  let clearly: number;
  if (steady) {
    label = 'tracking';
    clearly = margin(f.subjectSpeed!, thresholds.steadyShare * speed, 2);
  } else if (f.zoom >= thresholds.zoomOverShift * shift) {
    label = scaleSign > 0 ? 'push-in' : 'pull-out';
    clearly = margin(f.zoom, thresholds.zoomOverShift * shift, 2);
  } else {
    label = f.pan >= f.tilt ? 'pan' : 'tilt';
    clearly = margin(Math.max(f.pan, f.tilt), Math.max(1e-9, Math.min(f.pan, f.tilt)), 3);
  }
  return { label, clearly: Math.min(clearly, ...lines), steady };
}

/** The shot's confidence: the measure's quality (pairs measured, background inliers) times how clearly it decided. */
export function confidenceOf(f: ShotFeatures, clearly: number): number {
  const quality = f.coverage * clamp01((f.inliers - 0.15) / 0.35);
  return Math.round(quality * (0.5 + 0.5 * clearly) * 100) / 100;
}

/** The shot's measure and label from its frame pairs. */
export function classifyShot(
  pairs: readonly MotionPair[],
  frame: { width: number; height: number },
  thresholds: Thresholds = MOTION_CONFIG.classifier,
): ShotMeasure {
  const f = shotFeatures(pairs, frame);
  const valid = pairs.filter((p) => p.motion !== null);
  const sum = (pick: (m: PairMotion) => number) => valid.reduce((total, p) => total + pick(p.motion!), 0);
  const per = (value: number) => (f.seconds > 0 ? value / f.seconds : 0);
  const numbers = {
    panX: per(-sum((m) => m.dx)),
    panY: per(-sum((m) => m.dy)),
    scale: per(sum((m) => m.scale)),
    rotation: per(-sum((m) => m.rotation)),
    jitter: f.jitter,
  };
  if (f.seconds === 0) return { ...numbers, label: null, confidence: 0 };
  const { label, clearly, steady } = decideMotion(f, Math.sign(numbers.scale), thresholds);
  return {
    ...numbers,
    ...(steady === undefined ? {} : { subjectSteady: steady }),
    label,
    confidence: confidenceOf(f, clearly),
  };
}
