// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { ReframeClipLabel, ReframePrediction, ReframeSample } from './schema';

/** P3-V2 bars. subjectInFrame matches REFRAME_CONFIG.framesInShare. */
export const REFRAME_BARS = { subjectInFrame: 0.95, jitterFrames: 0 } as const;

/**
 * A labelled box counts as inside when at least this share of its area lies in the crop.
 * Same cut as REFRAME_CONFIG.boxInsideShare (QA's "in frame").
 */
export const INSIDE_AREA = 0.95;

/**
 * REFRAME_CONFIG.maxSpeedCropsPerSecond. The crop-path clamp also limits a velocity change to
 * twice that in one frame (a reversal from −vmax to +vmax), which is the acceleration cap.
 */
export const MAX_SPEED_CROPS_PER_SECOND = 1;

const SPEED_EPSILON = 1e-4;

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface ReframeClipScore {
  readonly clipId: string;
  readonly boxed: number;
  readonly inside: number;
  /** Labelled frames with no subject. */
  readonly fallbackFrames: number;
  /** A clip with no labelled subject anywhere whose plan still followed one (the planner invented a subject). */
  readonly fallbackMissed: boolean;
  readonly jitterFrames: number;
}

function hasBox(sample: ReframeSample): sample is Box & { readonly tFrame: number } {
  return 'w' in sample;
}

function overlapArea(box: Box, crop: Box): number {
  const width = Math.max(0, Math.min(box.x + box.w, crop.x + crop.w) - Math.max(box.x, crop.x));
  const height = Math.max(0, Math.min(box.y + box.h, crop.y + crop.h) - Math.max(box.y, crop.y));
  return width * height;
}

/** True when `minShare` of `box` lies inside `crop`. An empty box is inside (nothing of it is lost). */
export function boxInside(box: Box, crop: Box, minShare = INSIDE_AREA): boolean {
  const area = box.w * box.h;
  if (area <= 0) return true;
  return overlapArea(box, crop) / area >= minShare;
}

/**
 * Frames whose crop-centre speed exceeds one crop per second, or whose velocity changes by more than
 * the clamp can do in one frame. `centres[i]` is the crop at output frame i.
 */
export function speedJitterFrames(
  centres: readonly Box[],
  fps: number,
  maxSpeed = MAX_SPEED_CROPS_PER_SECOND,
): number[] {
  const bad: number[] = [];
  let prevVx = 0;
  let prevVy = 0;
  for (let frame = 1; frame < centres.length; frame += 1) {
    const current = centres[frame];
    const previous = centres[frame - 1];
    if (current === undefined || previous === undefined) continue;
    const vx = ((current.x - previous.x) / current.w) * fps;
    const vy = ((current.y - previous.y) / current.h) * fps;
    const accelCap = 2 * maxSpeed;
    const tooFast = Math.abs(vx) > maxSpeed + SPEED_EPSILON || Math.abs(vy) > maxSpeed + SPEED_EPSILON;
    const tooSharp =
      Math.abs(vx - prevVx) > accelCap + SPEED_EPSILON || Math.abs(vy - prevVy) > accelCap + SPEED_EPSILON;
    if (tooFast || tooSharp) bad.push(frame);
    prevVx = vx;
    prevVy = vy;
  }
  return bad;
}

export function scoreReframeClip(label: ReframeClipLabel, prediction: ReframePrediction): ReframeClipScore {
  const crops = new Map(prediction.crops.map((crop) => [crop.tFrame, crop]));
  let boxed = 0;
  let inside = 0;
  let fallbackFrames = 0;
  for (const sample of label.samples) {
    if (!hasBox(sample)) {
      fallbackFrames += 1;
      continue;
    }
    boxed += 1;
    const crop = crops.get(sample.tFrame);
    if (crop !== undefined && boxInside(sample, crop)) inside += 1;
  }
  const jitter = new Set<number>([
    ...speedJitterFrames(prediction.centres, label.fps),
    ...prediction.qaJitterFrames,
  ]);
  // The fallback is the planner's, read from its framing: a subjectless clip must not be framed as `subject`.
  const fallbackMissed = boxed === 0 && prediction.framing === 'subject';
  return { clipId: label.clipId, boxed, inside, fallbackFrames, fallbackMissed, jitterFrames: jitter.size };
}

/** Null when no labelled frame has a subject: there is nothing to keep in frame, so no share and no pass. */
export function subjectInFrameOf(rows: readonly ReframeClipScore[]): number | null {
  const boxed = rows.reduce((sum, row) => sum + row.boxed, 0);
  if (boxed === 0) return null;
  return rows.reduce((sum, row) => sum + row.inside, 0) / boxed;
}

export function reframeGatePasses(
  subjectInFrame: number | null,
  jitterFrames: number,
  fallbackMissed: number,
): boolean {
  return (
    subjectInFrame !== null &&
    subjectInFrame >= REFRAME_BARS.subjectInFrame &&
    jitterFrames <= REFRAME_BARS.jitterFrames &&
    fallbackMissed === 0
  );
}
