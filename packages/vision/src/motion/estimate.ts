// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The camera's move through each shot of a video (FRM1-MOT): one decode of gray frames at 384 px on the long side
 * (aspect kept), about 10 a second inside each shot (denser in a short one, so it still has six pairs), and the
 * background's similarity between each pair (pair.ts). The pairs go back as they are, so a caller whose shots move
 * (a breakdown's verdicts on its cuts) can classify any span of them again (classify.ts).
 *
 * CPU, in TypeScript, on every platform: a 384 px frame's corners and tracks take a few milliseconds, the decode
 * dominates (ADR 0002: decode and scale stay on media's VideoToolbox route; there is no GPU form of this tracker
 * yet, and the fallback is reported by the caller once).
 */
import { CancelledError, err, ok, type AsyncResult, type FrameRate } from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import { fitLongSide, probeSource, sampleFrames, type VideoSource } from '../media/frames';
import type { MotionPair } from './classify';
import { MOTION_CONFIG } from './config';
import { grayImage, pyramid, type Level } from './image';
import { pairMotion, type ShareBox } from './pair';

export interface ShotRange {
  /** Grid frames [start, end). */
  readonly start: number;
  readonly end: number;
}

export interface ShotPairs extends ShotRange {
  readonly pairs: MotionPair[];
}

export interface CameraMotionResult {
  /** The size the frames were read at. */
  readonly width: number;
  readonly height: number;
  readonly rate: FrameRate;
  readonly shots: ShotPairs[];
}

export interface CameraMotionOptions {
  readonly ranges: readonly ShotRange[];
  /** Pairs a second (default MOTION_CONFIG.rate). */
  readonly rate?: number;
  /**
   * The subject's boxes at a grid frame (shares of the frame, top left); undefined when none are known. Its points are
   * kept out of the background, and its box's move between the pair's frames is the subject's.
   */
  readonly subjects?: (frame: number) => readonly ShareBox[] | undefined;
  /**
   * Areas to leave out of the fit at a grid frame: burnt-in captions and overlays, which hold still while the camera
   * moves; undefined when there are none.
   */
  readonly ignore?: (frame: number) => readonly ShareBox[] | undefined;
  /** The video as already probed (a library job's frame source): no probe of `path` here. */
  readonly source?: VideoSource;
  readonly signal?: AbortSignal;
}

/**
 * The step between the frames read inside a shot: `fps / rate`, closer in a short shot so it still has `minPairs`
 * pairs. Frames read are the multiples of the step inside the shot, as media samples a window.
 */
export function stepIn(range: ShotRange, fps: number, rate: number, minPairs: number): number {
  const length = range.end - range.start;
  const every = Math.max(1, Math.round(fps / rate));
  const count = (step: number) => Math.floor((range.end - 1) / step) - Math.ceil(range.start / step) + 1;
  if (count(every) - 1 >= minPairs) return every;
  for (let step = every - 1; step >= 1; step--) if (count(step) - 1 >= minPairs) return step;
  return length >= 2 ? 1 : every;
}

/**
 * How far the main subject's box moved between two frames (centre, frame widths and heights): the largest box in the
 * first, and in the second the box nearest it. Undefined when either frame has none.
 */
export function boxShift(
  first: readonly ShareBox[] | undefined,
  second: readonly ShareBox[] | undefined,
): { dx: number; dy: number } | undefined {
  if (!first?.length || !second?.length) return undefined;
  const main = first.reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a));
  const cx = main.x + main.width / 2;
  const cy = main.y + main.height / 2;
  const centre = (b: ShareBox) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
  const near = second.reduce((a, b) =>
    Math.hypot(centre(b).x - cx, centre(b).y - cy) < Math.hypot(centre(a).x - cx, centre(a).y - cy) ? b : a,
  );
  return { dx: centre(near).x - cx, dy: centre(near).y - cy };
}

/** Measures the frame pairs of every range of the video at `path`. */
export async function cameraMotion(
  path: string,
  deps: { readonly media: MediaContext },
  options: CameraMotionOptions,
): AsyncResult<CameraMotionResult> {
  const source = options.source ? ok(options.source) : await probeSource(deps.media, path, options.signal);
  if (!source.ok) return source;
  const { rate } = source.value;
  const fps = rate.num / rate.den;
  const size = fitLongSide(source.value.width, source.value.height, MOTION_CONFIG.longSide);
  const count = source.value.frameCount ?? Number.MAX_SAFE_INTEGER;
  const ranges = [...options.ranges]
    .map((r) => ({ start: Math.max(0, r.start), end: Math.min(count, r.end) }))
    .filter((r) => r.end - r.start >= 2)
    .sort((a, b) => a.start - b.start);
  const steps = ranges.map((range) =>
    stepIn(range, fps, options.rate ?? MOTION_CONFIG.rate, MOTION_CONFIG.minPairs),
  );
  const shots: ShotPairs[] = ranges.map((range) => ({ ...range, pairs: [] }));
  // Runs of neighbouring shots read at the same step share one decode.
  const groups: { step: number; first: number; last: number }[] = [];
  steps.forEach((step, i) => {
    const group = groups[groups.length - 1];
    if (group && group.step === step && ranges[i]!.start - ranges[group.last]!.end <= step) group.last = i;
    else groups.push({ step, first: i, last: i });
  });
  for (const group of groups) {
    let previous: { shot: number; frame: number; levels: Level[] } | null = null;
    let cursor = group.first;
    const sampled = await sampleFrames(deps.media, source.value, {
      size,
      format: 'gray',
      every: group.step,
      window: { start: ranges[group.first]!.start, end: ranges[group.last]!.end },
      ...(options.signal ? { signal: options.signal } : {}),
      onFrame: (decoded) => {
        if (options.signal?.aborted) return;
        while (cursor <= group.last && ranges[cursor]!.end <= decoded.index) cursor++;
        const range = ranges[cursor];
        if (!range || decoded.index < range.start) return;
        const levels = pyramid(
          grayImage(decoded.data, decoded.width, decoded.height),
          MOTION_CONFIG.estimator.levels,
        );
        const before: { shot: number; frame: number; levels: Level[] } | null = previous;
        previous = { shot: cursor, frame: decoded.index, levels };
        if (!before || before.shot !== cursor) return;
        const boxes = options.subjects?.(before.frame);
        const ignore = options.ignore?.(before.frame);
        const found = pairMotion(before.levels, levels, {
          seed: decoded.index,
          ...(boxes ? { boxes } : {}),
          ...(ignore?.length ? { ignore } : {}),
        });
        // With a tracker's boxes, the subject's own move is its box's: steadier than points on moving limbs.
        const moved = boxes ? boxShift(boxes, options.subjects?.(decoded.index)) : undefined;
        const motion = found && moved !== undefined ? { ...found, subject: moved } : found;
        shots[cursor]!.pairs.push({
          frame: decoded.index,
          seconds: (decoded.index - before.frame) / fps,
          motion,
        });
      },
    });
    if (!sampled.ok) return sampled;
    if (options.signal?.aborted) return err(CancelledError());
  }
  return ok({ ...size, rate, shots });
}
