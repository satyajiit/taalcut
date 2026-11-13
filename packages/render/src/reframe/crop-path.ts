// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The virtual camera's path (SPEC P3.2, "Smoothing"): the constrained target points of one shot, filtered on
 * each axis by the 1€ filter, held still inside a deadzone and capped in speed, in source pixels. A shot is
 * filtered on its own and its first sample starts at its point: a cut is a cut, never a pan.
 *
 * 1. Deadzone: a raw point within `deadzone` of the last output feeds the last output instead, so a still
 *    subject gives a still crop: the output's step is exactly 0, not merely small.
 * 2. 1€ on the rest.
 * 3. Speed clamp (1€ doesn't cap speed): y = yₚ + clamp((x̂ − yₚ)/Δt, ±vmax)·Δt. Easing to the centre uses
 *    the same clamp, so nothing snaps.
 *
 * Each step moves the output towards a convex combination of points inside the allowed range, so a path of
 * constrained targets stays inside it.
 */
import { createOneEuroFilter, type OneEuroParams } from './one-euro';

export interface AxisSample {
  readonly tSeconds: number;
  readonly value: number;
}

export interface AxisSmoothing {
  readonly filter: OneEuroParams;
  /** Hold band around the last output, in the samples' units. */
  readonly deadzone: number;
  /** Largest speed of the output, units per second. */
  readonly maxSpeed: number;
}

/** The smoothed output at each sample. */
export function smoothAxis(samples: readonly AxisSample[], smoothing: AxisSmoothing): number[] {
  const filter = createOneEuroFilter(smoothing.filter);
  const out: number[] = [];
  samples.forEach((sample, index) => {
    if (index === 0) {
      out.push(filter.filter(sample.value, sample.tSeconds));
      return;
    }
    const last = out[index - 1] ?? sample.value;
    const dt = sample.tSeconds - (samples[index - 1]?.tSeconds ?? sample.tSeconds);
    if (Math.abs(sample.value - last) < smoothing.deadzone || dt <= 0) {
      filter.hold(last, sample.tSeconds);
      out.push(last);
      return;
    }
    const filtered = filter.filter(sample.value, sample.tSeconds);
    const speed = Math.max(-smoothing.maxSpeed, Math.min(smoothing.maxSpeed, (filtered - last) / dt));
    out.push(last + speed * dt);
  });
  return out;
}

export interface PathPoint {
  /** Output frame from the visual's visible start; fractional where a sample falls between frames. */
  readonly frame: number;
  readonly x: number;
  readonly y: number;
}

/** Smooths both axes of a shot's targets; `frame` / `fps` is each sample's time. */
export function smoothPath(
  targets: readonly PathPoint[],
  fps: number,
  smoothing: { readonly x: AxisSmoothing; readonly y: AxisSmoothing },
): PathPoint[] {
  const xs = smoothAxis(
    targets.map((point) => ({ tSeconds: point.frame / fps, value: point.x })),
    smoothing.x,
  );
  const ys = smoothAxis(
    targets.map((point) => ({ tSeconds: point.frame / fps, value: point.y })),
    smoothing.y,
  );
  return targets.map((point, index) => ({
    frame: point.frame,
    x: xs[index] ?? point.x,
    y: ys[index] ?? point.y,
  }));
}

/** The value of a piecewise-linear path at `frame`: held flat before its first and after its last point. */
export function valueAt<T extends { readonly frame: number }>(
  points: readonly T[],
  frame: number,
  lerp: (a: T, b: T, share: number) => T,
): T | undefined {
  const first = points[0];
  if (!first) return undefined;
  if (frame <= first.frame) return first;
  for (let index = 1; index < points.length; index++) {
    const right = points[index];
    const left = points[index - 1];
    if (!right || !left) continue;
    if (frame <= right.frame) {
      const span = right.frame - left.frame;
      return span <= 0 ? right : lerp(left, right, (frame - left.frame) / span);
    }
  }
  return points[points.length - 1];
}

const lerpPoint = (a: PathPoint, b: PathPoint, share: number): PathPoint => ({
  frame: a.frame + (b.frame - a.frame) * share,
  x: a.x + (b.x - a.x) * share,
  y: a.y + (b.y - a.y) * share,
});

/**
 * The path as keys on whole output frames from 0 to `frames` (the visible window's end), one per sample
 * inside it, plus the window's two ends. Linear between keys is the linear resample, which can't add jitter
 * above the sample steps. Two samples on one frame keep the later.
 */
export function pathKeys(points: readonly PathPoint[], frames: number): PathPoint[] {
  const byFrame = new Map<number, PathPoint>();
  const at = (frame: number) => {
    const value = valueAt(points, frame, lerpPoint);
    if (value) byFrame.set(frame, { frame, x: value.x, y: value.y });
  };
  at(0);
  for (const point of points) {
    const frame = Math.round(point.frame);
    if (frame > 0 && frame < frames) byFrame.set(frame, { frame, x: point.x, y: point.y });
  }
  at(frames);
  return [...byFrame.values()].sort((a, b) => a.frame - b.frame);
}

/** The largest distance the path's point travels from its start, per axis. */
export function pathTravel(points: readonly PathPoint[]): { readonly x: number; readonly y: number } {
  if (points.length === 0) return { x: 0, y: 0 };
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return { x: Math.max(...xs) - Math.min(...xs), y: Math.max(...ys) - Math.min(...ys) };
}
