// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Runs each camera-motion reader on one eval clip (FRM1-MOT):
 *
 * - **measured:** vision's estimator and classifier (motion/), with the clip's subject boxes (as a tracker would
 *   give them) and without any;
 * - **breakdown before FRM1:** vision.motionCurve at 10 a second, its mean through the shot without the fastest and
 *   slowest sample (templates' shotMotion), and the `moves` bit at the config's 0.01;
 * - **library before FRM1:** the analysis pass's samples (256 px, 10 a second, frameStats and sampleSignals) and
 *   scoreShot's motion class.
 */
import type { CameraMotion } from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import {
  cameraMotion,
  classifyShot,
  fitLongSide,
  frameStats,
  motionCurve,
  probeSource,
  sampleFrames,
  sampleSignals,
  scoreShot,
  shotFeatures,
  type FrameStats,
  type SampleSignals,
  type ShareBox,
  type ShotFeatures,
  type ShotMeasure,
} from '@taalcut/vision';
import type { ManifestClip } from './schema';

export interface Reading {
  readonly measure: ShotMeasure;
  readonly features: ShotFeatures;
  readonly pairs: number;
  readonly ms: number;
}

export interface ClipPrediction {
  readonly id: string;
  readonly split: ManifestClip['split'];
  readonly move: ManifestClip['plan']['move'];
  readonly label: CameraMotion;
  readonly clear: boolean;
  readonly aspect: ManifestClip['plan']['aspect'];
  readonly seconds: number;
  readonly withBoxes: Reading;
  readonly plain: Reading;
  readonly before: {
    /** templates' shotMotion over vision.motionCurve: frame widths a second. */
    readonly breakdownMotion: number | null;
    readonly breakdownMoves: boolean | null;
    /** The library's scoreShot class. */
    readonly library: CameraMotion;
  };
}

const MOVES_LINE = 0.01;

/** templates' shotMotion (BRK1): the curve's mean inside the shot without its fastest and slowest sample. */
function shotMotionOf(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const kept = sorted.length >= 3 ? sorted.slice(1, -1) : sorted;
  return kept.reduce((sum, v) => sum + v, 0) / kept.length;
}

/** The library's motion class as `vision.analyse` computes it, on the pass's samples (256 px, every 3rd frame at 30). */
async function libraryClass(path: string, media: MediaContext): Promise<CameraMotion> {
  const source = await probeSource(media, path);
  if (!source.ok) throw new Error(`${path}: ${source.error.code}`);
  const fps = source.value.rate.num / source.value.rate.den;
  const every = Math.max(1, Math.round(fps / 10));
  const samples: SampleSignals[] = [];
  let previous: FrameStats | undefined;
  const run = await sampleFrames(media, source.value, {
    size: fitLongSide(source.value.width, source.value.height, 256),
    format: 'gray',
    every,
    onFrame: (frame) => {
      const stats = frameStats(frame);
      samples.push(sampleSignals(stats, previous));
      previous = stats;
    },
  });
  if (!run.ok) throw new Error(`${path}: ${run.error.code}`);
  return scoreShot(samples, every / fps).motion;
}

function boxesAt(clip: ManifestClip): (frame: number) => ShareBox[] | undefined {
  const fps = clip.plan.fps;
  return (frame) => {
    const t = frame / fps;
    let best = clip.subjectTrack[0];
    for (const sample of clip.subjectTrack)
      if (Math.abs(sample.t - t) < Math.abs((best?.t ?? 0) - t)) best = sample;
    return best && best.boxes.length > 0 ? [...best.boxes] : undefined;
  };
}

async function measured(
  path: string,
  media: MediaContext,
  frames: number,
  subjects?: (frame: number) => ShareBox[] | undefined,
): Promise<Reading> {
  const started = performance.now();
  const result = await cameraMotion(
    path,
    { media },
    { ranges: [{ start: 0, end: frames }], ...(subjects ? { subjects } : {}) },
  );
  if (!result.ok) throw new Error(`${path}: ${result.error.code}`);
  const ms = performance.now() - started;
  const pairs = result.value.shots[0]?.pairs ?? [];
  const frame = { width: result.value.width, height: result.value.height };
  return {
    measure: classifyShot(pairs, frame),
    features: shotFeatures(pairs, frame),
    pairs: pairs.length,
    ms,
  };
}

export async function predictClip(
  clip: ManifestClip,
  path: string,
  media: MediaContext,
): Promise<ClipPrediction> {
  const frames = Math.round(clip.plan.seconds * clip.plan.fps);
  const withBoxes = clip.plan.subjects.length > 0 ? await measured(path, media, frames, boxesAt(clip)) : null;
  const plain = await measured(path, media, frames);
  const curve = await motionCurve(path, { media }, { rate: 10, ranges: [{ start: 0, end: frames }] });
  if (!curve.ok) throw new Error(`${path}: ${curve.error.code}`);
  const breakdownMotion = shotMotionOf(curve.value.filter((s) => s.frame > 0).map((s) => s.speed));
  return {
    id: clip.id,
    split: clip.split,
    move: clip.plan.move,
    label: clip.label,
    clear: clip.plan.clear,
    aspect: clip.plan.aspect,
    seconds: clip.plan.seconds,
    withBoxes: withBoxes ?? plain,
    plain,
    before: {
      breakdownMotion,
      breakdownMoves: breakdownMotion === null ? null : breakdownMotion >= MOVES_LINE,
      library: await libraryClass(path, media),
    },
  };
}
