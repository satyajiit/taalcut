// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Two methods for every cut (SPEC "Breakdown pipeline"). Method A, scdet's
 * scene score, proposes cuts with a low threshold so recall stays high.
 * Method B, frame embeddings, compares the mean of the frames before each
 * proposal with the frames after it: far apart confirms (`both`), close
 * drops it (a flash, an exposure jump), in between is disputed. B also scans
 * the whole reel for jumps A never proposed: soft cuts (dissolves, whips),
 * placed at the middle of their ramp and always disputed. Disputes go to the
 * Analyst; without a verdict a rule decides (`ruleKeeps`).
 *
 * A cut is the first frame of the new shot (scdet's convention; the eval
 * scores ±2 frames). Pure: embeddings come in through `vectorAt`.
 */
import type { BreakdownConfig } from './config';

export type VectorAt = (frame: number) => Float32Array | undefined;

export interface CutFinding {
  readonly frame: number;
  readonly method: 'both' | 'scdet' | 'embedding';
  readonly status: 'confirmed' | 'disputed';
  /** Method A's score at the frame; null for a soft cut A didn't propose. */
  readonly score: number | null;
  /** Method B's distance; null when the frames weren't embedded. */
  readonly distance: number | null;
  /** A soft cut's ramp, first and last frame of the change. */
  readonly ramp: { readonly start: number; readonly end: number } | null;
  /** What the rule decides when no vision verdict comes back. */
  readonly ruleKeeps: boolean;
}

type CutsConfig = Pick<BreakdownConfig, 'scdet' | 'embed'>;

/** Frames whose score reaches `propose`; of proposals within `peakWindow` frames, the peak (earliest on a tie). */
export function proposeCuts(scores: readonly number[], config: CutsConfig): number[] {
  const peaks: number[] = [];
  let run: { frame: number; score: number; last: number } | null = null;
  const flush = () => {
    if (run) peaks.push(run.frame);
    run = null;
  };
  // Frame 0 starts the reel; it's never a cut.
  for (let frame = 1; frame < scores.length; frame++) {
    const score = scores[frame]!;
    if (score < config.scdet.propose) continue;
    if (run && frame - run.last > config.scdet.peakWindow) flush();
    if (!run) run = { frame, score, last: frame };
    else {
      if (score > run.score) run = { frame, score, last: frame };
      else run.last = frame;
    }
  }
  flush();
  return peaks;
}

/** 1 − cosine similarity of two vectors (normalised here, so any embedding works). */
export function cosineDistance(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return na === nb ? 0 : 1;
  return Math.min(2, Math.max(0, 1 - dot / Math.sqrt(na * nb)));
}

function mean(vectors: readonly Float32Array[]): Float32Array | undefined {
  if (vectors.length === 0) return undefined;
  const out = new Float32Array(vectors[0]!.length);
  for (const vector of vectors) for (let i = 0; i < out.length; i++) out[i]! += vector[i]!;
  return out;
}

/** The frames method B averages either side of a cut at `frame` (one more after, see contextDistance). */
export function contextFrames(frame: number, total: number, context: number): number[] {
  const frames: number[] = [];
  for (let f = Math.max(0, frame - context); f < Math.min(total, frame + context + 1); f++) frames.push(f);
  return frames;
}

/**
 * Distance between the mean of the `context` frames before `frame` and the
 * mean of `frame` and after. A one-frame flash or exposure jump moves the
 * after-mean by a third and would pass for a cut, so the after window is
 * also taken one frame later and the smaller distance counts: after a flash
 * the picture is back, after a cut it isn't.
 */
export function contextDistance(
  vectorAt: VectorAt,
  frame: number,
  total: number,
  context: number,
): number | null {
  const pick = (from: number, to: number) => {
    const out: Float32Array[] = [];
    for (let f = Math.max(0, from); f < Math.min(total, to); f++) {
      const vector = vectorAt(f);
      if (vector) out.push(vector);
    }
    return mean(out);
  };
  const before = pick(frame - context, frame);
  const after = pick(frame, frame + context);
  if (!before || !after) return null;
  const later = pick(frame + 1, frame + 1 + context);
  const distance = cosineDistance(before, after);
  return later ? Math.min(distance, cosineDistance(before, later)) : distance;
}

/** A's proposal judged by B: confirmed, disputed, or null when B says it isn't a cut. */
export function judgeProposal(
  frame: number,
  score: number,
  distance: number | null,
  config: CutsConfig,
): CutFinding | null {
  const strongA = score >= config.scdet.strong;
  if (distance === null)
    return {
      frame,
      method: 'scdet',
      status: strongA ? 'confirmed' : 'disputed',
      score,
      distance,
      ramp: null,
      ruleKeeps: strongA,
    };
  if (distance >= config.embed.confirm)
    return { frame, method: 'both', status: 'confirmed', score, distance, ramp: null, ruleKeeps: true };
  if (distance <= config.embed.reject) return null;
  const ruleKeeps = strongA || distance >= config.embed.strong;
  return { frame, method: 'scdet', status: 'disputed', score, distance, ramp: null, ruleKeeps };
}

/** Frames B samples across the reel: `fps` a second at `rate` frames a second. */
export function scanFrames(total: number, rate: number, fps: number): number[] {
  const frames: number[] = [];
  const step = rate / fps;
  for (let i = 0; Math.round(i * step) < total; i++) {
    const frame = Math.round(i * step);
    if (frames[frames.length - 1] !== frame) frames.push(frame);
  }
  return frames;
}

/**
 * Stretches of the scan where B sees a change of at least `soft` over one or
 * two samples. Overlapping stretches merge. Every frame inside is embedded
 * next, and locateChanges finds what changed where; changes A already
 * proposed are dropped there, so a cut A missed beside one it found (a
 * two-frame shot) still shows up.
 */
export function softWindows(
  scan: readonly number[],
  vectorAt: VectorAt,
  config: CutsConfig,
): [number, number][] {
  const windows: [number, number][] = [];
  for (let i = 0; i < scan.length; i++)
    for (const step of [1, 2]) {
      const a = scan[i]!;
      const b = scan[i + step];
      if (b === undefined) continue;
      const va = vectorAt(a);
      const vb = vectorAt(b);
      if (va && vb && cosineDistance(va, vb) >= config.embed.soft) windows.push([a, b]);
    }
  windows.sort((x, y) => x[0] - y[0]);
  const merged: [number, number][] = [];
  for (const window of windows) {
    const last = merged[merged.length - 1];
    if (last && window[0] <= last[1]) last[1] = Math.max(last[1], window[1]);
    else merged.push([...window]);
  }
  return merged;
}

/**
 * Where the change happens inside a window, from per-frame embeddings: the
 * ramp runs from the frame whose distance from the window's first frame
 * reaches `rampLow` of the total to the one that reaches `rampHigh`; the cut
 * is its middle. Null when the window holds no change after all.
 */
export function locateRamp(
  window: readonly [number, number],
  vectorAt: VectorAt,
  config: CutsConfig,
): { frame: number; start: number; end: number; distance: number } | null {
  const origin = vectorAt(window[0]);
  if (!origin) return null;
  const distances: { frame: number; d: number }[] = [];
  for (let frame = window[0]; frame <= window[1]; frame++) {
    const vector = vectorAt(frame);
    if (vector) distances.push({ frame, d: cosineDistance(origin, vector) });
  }
  const total = Math.max(...distances.map((item) => item.d));
  if (!(total >= config.embed.soft)) return null;
  const start = distances.find((item) => item.d >= config.embed.rampLow * total)!.frame;
  const end = distances.find((item) => item.d >= config.embed.rampHigh * total)!.frame;
  // A one-frame "ramp" is a hard cut A missed: the change lands on `end`, the new shot's first frame.
  const frame = end - start <= 1 ? end : Math.round((start + end) / 2);
  return { frame, start, end, distance: total };
}

export interface Change {
  readonly frame: number;
  readonly start: number;
  readonly end: number;
  readonly distance: number;
  /** A one-frame jump (a hard cut A missed) rather than a gradual ramp. */
  readonly hard: boolean;
}

/**
 * Every change inside a window, from per-frame embeddings: one-frame jumps of
 * at least `soft` are hard cuts (judged like A's proposals, by the frames
 * either side); between them, a gradual change of at least `soft` is a ramp
 * (a dissolve, a fade, a whip) cut at its middle.
 */
export function locateChanges(
  window: readonly [number, number],
  vectorAt: VectorAt,
  total: number,
  config: CutsConfig,
): Change[] {
  const jumps: number[] = [];
  for (let frame = window[0] + 1; frame <= window[1]; frame++) {
    const before = vectorAt(frame - 1);
    const after = vectorAt(frame);
    if (before && after && cosineDistance(before, after) >= config.embed.soft) jumps.push(frame);
  }
  const changes: Change[] = jumps.map((frame) => ({
    frame,
    start: frame,
    end: frame,
    distance: contextDistance(vectorAt, frame, total, config.embed.context) ?? 0,
    hard: true,
  }));
  const edges = [window[0], ...jumps, window[1] + 1];
  for (let i = 0; i + 1 < edges.length; i++) {
    const from = edges[i]!;
    const to = edges[i + 1]! - 1;
    if (to - from < 2) continue;
    const ramp = locateRamp([from, to], vectorAt, config);
    if (ramp && ramp.end - ramp.start >= 2) changes.push({ ...ramp, hard: false });
  }
  return changes.sort((a, b) => a.frame - b.frame);
}

export function softCut(
  change: Omit<Change, 'hard'> & { readonly hard?: boolean },
  config: CutsConfig,
): CutFinding {
  return {
    frame: change.frame,
    method: 'embedding',
    status: 'disputed',
    score: null,
    distance: change.distance,
    ramp: change.hard ? null : { start: change.start, end: change.end },
    ruleKeeps: change.distance >= config.embed.strong,
  };
}
