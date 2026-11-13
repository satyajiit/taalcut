// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The camera's move through each slot, measured (FRM1-MOT). The breakdown measures the background's frame pairs
 * between every candidate cut (vision's estimator, through the `cameraMotion` port) and keeps them in the draft, so
 * whatever slots the Analyst's verdicts leave, each one's move is classified from its own pairs (vision's
 * classifier). The label decides the slot's `intent.motion`; an unsure one leaves it null with a `motionUnsure`
 * doubt, and the measure stays on the slot for the review to show.
 */
import {
  ok,
  RationalTime,
  type AsyncResult,
  type Box,
  type CameraMotion,
  type CameraMotionMeasure,
  type ReelSubjects,
} from '@taalcut/core';
import { cameraMeasureOf, classifyShot, MOTION_CONFIG, type MotionPair } from '@taalcut/vision';
import { z } from 'zod';
import type { StepContext } from './steps';

const frame = z.int().nonnegative();

/**
 * A pair as numbers: [frame, seconds] when it couldn't be measured, else [frame, seconds, dx, dy, scale, rotation,
 * inliers, points, residual] and, when a subject was seen, its [dx, dy] after.
 */
const pairSchema = z.array(z.number()).min(2).max(11);

export const draftCameraSchema = z.object({
  /** The estimator's version (vision's MOTION_CONFIG.version). */
  version: z.int().positive(),
  /** The size the frames were read at. */
  width: z.int().positive(),
  height: z.int().positive(),
  /** The spans between candidate cuts (frames [start, end)), each with its pairs in time order. */
  segments: z
    .array(
      z.object({
        start: frame,
        end: frame,
        pairs: z.array(pairSchema).max(2000),
        /** The span is a fade's tail (the shot fading out): no slot's move is read from it. */
        fade: z.literal(true).optional(),
      }),
    )
    .max(800),
});
export type DraftCamera = z.output<typeof draftCameraSchema>;

const round = (value: number, digits = 6) => Number(value.toPrecision(digits));

/** The estimator's pairs as the draft keeps them. */
export function encodePairs(pairs: readonly MotionPair[]): number[][] {
  return pairs.map(({ frame: at, seconds, motion }) =>
    motion
      ? [
          at,
          round(seconds),
          round(motion.dx),
          round(motion.dy),
          round(motion.scale),
          round(motion.rotation),
          round(motion.inliers, 3),
          motion.points,
          round(motion.residual, 4),
          ...(motion.subject ? [round(motion.subject.dx), round(motion.subject.dy)] : []),
        ]
      : [at, round(seconds)],
  );
}

function decodePair(row: readonly number[]): MotionPair {
  const [at = 0, seconds = 0, dx, dy, scale, rotation, inliers, points, residual, sdx, sdy] = row;
  if (dx === undefined) return { frame: at, seconds, motion: null };
  return {
    frame: at,
    seconds,
    motion: {
      dx,
      dy: dy ?? 0,
      scale: scale ?? 0,
      rotation: rotation ?? 0,
      inliers: inliers ?? 0,
      points: points ?? 0,
      residual: residual ?? 0,
      subject: sdx === undefined ? null : { dx: sdx, dy: sdy ?? 0 },
    },
  };
}

/** The pairs inside [start, end): every segment that lies within it, but a fade's tail. */
export function pairsIn(
  camera: DraftCamera,
  bounds: { readonly start: number; readonly end: number },
): MotionPair[] {
  return camera.segments
    .filter((segment) => !segment.fade && segment.start >= bounds.start && segment.end <= bounds.end)
    .flatMap((segment) => segment.pairs.map(decodePair));
}

/** The reel's people at a frame: the sample nearest it within this many seconds, else none. */
const SUBJECT_NEAR_SECONDS = 0.2;

/**
 * The subject boxes at a frame from the reel's subjects (FRM1-SUB's `ReelSubjects`): the people of the nearest
 * sample, or its heads when it found no body; undefined when no sample is near.
 */
export function subjectBoxesAt(
  subjects: ReelSubjects | null,
  rate: StepContext['rate'],
): ((frame: number) => readonly Box[] | undefined) | undefined {
  if (!subjects || subjects.samples.length === 0) return undefined;
  const samples = subjects.samples.map((sample) => ({
    seconds: RationalTime.toSeconds(sample.t),
    boxes: (sample.people.length > 0 ? sample.people : sample.heads).map((entry) => entry.box),
  }));
  return (frame) => {
    const at = RationalTime.toSeconds(RationalTime.of(frame, rate));
    let best: (typeof samples)[number] | undefined;
    for (const sample of samples)
      if (!best || Math.abs(sample.seconds - at) < Math.abs(best.seconds - at)) best = sample;
    return best && Math.abs(best.seconds - at) <= SUBJECT_NEAR_SECONDS && best.boxes.length > 0
      ? best.boxes
      : undefined;
  };
}

/**
 * Measures the camera between every candidate cut (confirmed or disputed) and from every fade's start, so any slots
 * the verdicts leave are unions of whole spans. Overlays are left out of the fit while they show (they hold still
 * while the camera moves), and the reel's people are the subject when FRM1-SUB found them. Null without the port.
 */
export async function measureCamera(
  ctx: StepContext,
  evidence: {
    readonly cuts: readonly number[];
    readonly fades: readonly number[];
    readonly overlays: readonly {
      readonly start: RationalTime;
      readonly duration: RationalTime;
      readonly box: Box;
    }[];
    readonly subjects: ReelSubjects | null;
  },
): AsyncResult<DraftCamera | null> {
  const measure = ctx.analysers.vision.cameraMotion;
  if (!measure) return ok(null);
  const edges = [...new Set([0, ...evidence.cuts, ...evidence.fades, ctx.total])]
    .filter((frame) => frame >= 0 && frame <= ctx.total)
    .sort((a, b) => a - b);
  const ranges = edges
    .slice(0, -1)
    .map((start, i) => ({ start, end: edges[i + 1]! }))
    .filter((range) => range.end - range.start >= 2);
  const shown = evidence.overlays.map((overlay) => {
    const start = RationalTime.toFrames(overlay.start, ctx.rate);
    return { start, end: start + RationalTime.toFrames(overlay.duration, ctx.rate), box: overlay.box };
  });
  const ignore = (frame: number) => {
    const boxes = shown.filter((item) => item.start <= frame && frame < item.end).map((item) => item.box);
    return boxes.length > 0 ? boxes : undefined;
  };
  const subjects = subjectBoxesAt(evidence.subjects, ctx.rate);
  const found = await measure(ctx.path, {
    ranges,
    ignore,
    ...(subjects ? { subjects } : {}),
    signal: ctx.signal,
  });
  if (!found.ok) return found;
  const fades = new Set(evidence.fades);
  const parsed = draftCameraSchema.safeParse({
    version: found.value.version,
    width: found.value.width,
    height: found.value.height,
    segments: found.value.shots.map((shot) => ({
      start: shot.start,
      end: shot.end,
      pairs: encodePairs(shot.pairs),
      ...(fades.has(shot.start) ? { fade: true } : {}),
    })),
  });
  return ok(parsed.success ? parsed.data : null);
}

/**
 * A slot's measure from the draft's pairs; null when the draft has none (no estimator), none fall inside it, or not
 * one could be measured (a flat card has nothing to track: no move to ask about).
 */
export function slotMeasure(
  camera: DraftCamera | undefined,
  bounds: { readonly start: number; readonly end: number },
): CameraMotionMeasure | null {
  if (!camera) return null;
  const pairs = pairsIn(camera, bounds);
  if (pairs.every((pair) => pair.motion === null)) return null;
  return cameraMeasureOf(classifyShot(pairs, { width: camera.width, height: camera.height }), camera.version);
}

/** The slot's motion from its measure: the label when sure, else unknown and asked about. */
export function measuredMotion(measure: CameraMotionMeasure | null): {
  readonly motion: CameraMotion | null;
  readonly unsure: boolean;
} {
  if (!measure) return { motion: null, unsure: false };
  if (measure.label === null || measure.confidence < MOTION_CONFIG.classifier.sure)
    return { motion: null, unsure: true };
  return { motion: measure.label, unsure: false };
}

/** Which way, in words: "right", "up and left". Empty under a tenth of the larger axis. */
function direction(measure: CameraMotionMeasure): string {
  const across = Math.abs(measure.panX);
  const down = Math.abs(measure.panY);
  const words: string[] = [];
  if (down >= 0.3 * Math.max(across, down) && down > 0) words.push(measure.panY > 0 ? 'down' : 'up');
  if (across >= 0.3 * Math.max(across, down) && across > 0) words.push(measure.panX > 0 ? 'right' : 'left');
  return words.join(' and ');
}

const MOVE_WORDS: Readonly<Record<CameraMotion, string>> = {
  static: 'static: the camera holds still (a subject may move)',
  pan: 'pan',
  tilt: 'tilt',
  'push-in': 'push-in: the camera moves in',
  'pull-out': 'pull-out: the camera moves back',
  handheld: 'handheld: the camera shakes a little in the hand, without a steady move',
  tracking: 'tracking: the camera follows the subject, who stays in frame',
};

/** The longest `cameraWords` can be. */
export const CAMERA_WORDS_CHARS = 120;

/**
 * The measured move as plain words for the Analyst and the strip describer (English, model-facing): "pan right",
 * "tracking: the camera follows the subject, who stays in frame (moving right)", or "unsure: maybe …".
 */
export function cameraWords(measure: CameraMotionMeasure | null): string | null {
  if (!measure || measure.label === null) return null;
  const way = direction(measure);
  const label = measure.label;
  const base =
    label === 'pan' || label === 'tilt'
      ? `${label}${way ? ` ${way}` : ''}`
      : `${MOVE_WORDS[label]}${label === 'tracking' && way ? ` (moving ${way})` : ''}`;
  return measuredMotion(measure).unsure ? `unsure: maybe ${base}` : base;
}
