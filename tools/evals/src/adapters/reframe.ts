// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Runs planVisualFraming on the labelled boxes. The boxes are the recorded subject track:
 * nothing here calls the mac helper or Vision.
 */
import {
  FrameRate,
  newId,
  RationalTime,
  subjectTrackSchema,
  TimeRange,
  type SubjectSample,
  type SubjectTrack,
} from '@taalcut/core';
import {
  cropAt,
  measureJitter,
  planVisualFraming,
  REFRAME_CONFIG,
  TRACK_RECIPE,
  type SourceRect,
  type VisualFraming,
} from '@taalcut/render';
import type { ReframeClipLabel, ReframePrediction, ReframeSample } from '../reframe/schema';
import { requireSyntheticLabels } from './synthetic-only';

const CONFIDENCE = 0.9;
/** Tracker rate the reframe recipe records between the 4 fps labels. */
const TRACK_HZ = 12;

interface FractionBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

function hasBox(
  sample: ReframeSample,
): sample is ReframeSample & { x: number; y: number; w: number; h: number } {
  return 'w' in sample;
}

function clampBox(box: FractionBox): FractionBox | null {
  const x = Math.min(1, Math.max(0, box.x));
  const y = Math.min(1, Math.max(0, box.y));
  const width = Math.min(1 - x, Math.max(0, box.width));
  const height = Math.min(1 - y, Math.max(0, box.height));
  if (width <= 1e-6 || height <= 1e-6) return null;
  return { x, y, width, height };
}

function faceOf(sample: ReframeSample, source: ReframeClipLabel['source']): FractionBox | null {
  if (!hasBox(sample)) return null;
  return clampBox({
    x: sample.x / source.width,
    y: sample.y / source.height,
    width: sample.w / source.width,
    height: sample.h / source.height,
  });
}

/** A body under the labelled face, the proportions render's walking-subject case uses. */
function humanUnder(face: FractionBox): FractionBox | null {
  return clampBox({ x: face.x - 0.02, y: face.y - 0.05, width: face.width + 0.04, height: 0.7 });
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function faceAt(marks: readonly { frame: number; face: FractionBox }[], frame: number): FractionBox {
  const first = marks[0];
  const last = marks[marks.length - 1];
  if (first === undefined || last === undefined) throw new Error('face track is empty');
  if (frame <= first.frame) return first.face;
  if (frame >= last.frame) return last.face;
  let hi = 1;
  while (hi < marks.length && (marks[hi]?.frame ?? Infinity) < frame) hi += 1;
  const right = marks[hi] ?? last;
  const left = marks[hi - 1] ?? first;
  const span = right.frame - left.frame;
  const t = span === 0 ? 0 : (frame - left.frame) / span;
  return {
    x: lerp(left.face.x, right.face.x, t),
    y: lerp(left.face.y, right.face.y, t),
    width: lerp(left.face.width, right.face.width, t),
    height: lerp(left.face.height, right.face.height, t),
  };
}

function sampleAt(rate: FrameRate, seconds: number, face: FractionBox | null): SubjectSample {
  const human = face ? humanUnder(face) : null;
  return {
    t: RationalTime.fromSeconds(seconds, rate),
    source: 'detect',
    faces: face ? [{ box: face, confidence: CONFIDENCE, roll: 0, yaw: 0, pitch: 0 }] : [],
    humans: human ? [{ box: human, confidence: CONFIDENCE }] : [],
    saliency: [],
    subject: {
      kind: face ? 'face' : 'none',
      box: face,
      focus: face ? { x: face.x + face.width / 2, y: face.y + face.height / 2 } : null,
      confidence: face ? CONFIDENCE : 0,
    },
  };
}

function trackFor(label: ReframeClipLabel, rate: FrameRate): SubjectTrack {
  const marks = label.samples.flatMap((sample) => {
    const face = faceOf(sample, label.source);
    return face ? [{ frame: sample.tFrame, face }] : [];
  });
  const seconds = label.frames / label.fps + 1;
  const count = Math.max(2, Math.ceil(seconds * TRACK_HZ));
  const samples = Array.from({ length: count }, (_, index) => {
    const at = index / TRACK_HZ;
    const face = marks.length === 0 ? null : clampBox(faceAt(marks, at * label.fps));
    return sampleAt(rate, at, face);
  });
  return subjectTrackSchema.parse({
    version: 1,
    assetId: newId<'Asset'>(),
    contentHash: 's'.repeat(64),
    range: TimeRange.of(RationalTime.zero(rate), RationalTime.fromSeconds(seconds, rate)),
    recipe: TRACK_RECIPE,
    compute: { faces: 'cpu', humans: 'cpu' },
    samples,
  });
}

function safeRect(canvas: ReframeClipLabel['canvas']): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const sx = canvas.width / 1080;
  const sy = canvas.height / 1920;
  return { x: 120 * sx, y: 288 * sy, width: 540 * sx, height: 672 * sy };
}

function qaJitter(
  framing: Extract<VisualFraming, { kind: 'crop' }>,
  label: ReframeClipLabel,
  fps: number,
): number[] {
  if (framing.keys.length < 2) return [];
  const window = framing.keys[0]?.rect ?? { width: 1, height: 1 };
  const px = { x: label.canvas.width / window.width, y: label.canvas.height / window.height };
  const deadzone = {
    x: REFRAME_CONFIG.deadzoneFraction * px.x,
    y: ((REFRAME_CONFIG.deadzoneFraction * label.source.width) / label.source.height) * px.y,
  };
  const bad = new Set<number>();
  for (const axis of ['x', 'y'] as const) {
    const size = axis === 'x' ? 'width' : 'height';
    const path = Array.from({ length: label.frames + 1 }, (_, frame) => {
      const crop = cropAt(framing.keys, frame);
      return (crop[axis] + crop[size] / 2) * px[axis];
    });
    const report = measureJitter({
      path,
      raw: framing.keys.map((key, index) => {
        const point = framing.raw[index];
        return { frame: key.frame, value: point ? point[axis] * px[axis] : null };
      }),
      deadzone: deadzone[axis],
      fps,
      config: REFRAME_CONFIG,
    });
    for (const entry of report.holdViolations) bad.add(entry.frame);
    for (const entry of report.wobbles) bad.add(entry.frame);
  }
  return [...bad];
}

function predictionFor(label: ReframeClipLabel): ReframePrediction {
  if (!Number.isInteger(label.fps)) throw new Error(`Reframe fps must be a whole number, got ${label.fps}`);
  const rate = FrameRate.of(label.fps);
  const framing = planVisualFraming({
    visual: {
      kind: 'video',
      reframe: { mode: 'auto', nudge: { x: 0, y: 0 }, scale: 1 },
      visible: { start: 0, end: label.frames },
      cut: { start: 0, end: label.frames },
      sourceIn: RationalTime.zero(rate),
      speed: null,
    },
    source: label.source,
    canvas: label.canvas,
    safe: safeRect(label.canvas),
    captionBandTop: null,
    track: trackFor(label, rate),
    rate,
    canvasChanged: false,
  });
  if (framing.kind !== 'crop') {
    const outcome = framing.kind === 'fit' ? 'fit' : framing.reason;
    return { clipId: label.clipId, framing: outcome, crops: [], centres: [], qaJitterFrames: [] };
  }
  const pixel = (rect: SourceRect) => ({
    x: rect.x * label.source.width,
    y: rect.y * label.source.height,
    w: rect.width * label.source.width,
    h: rect.height * label.source.height,
  });
  return {
    clipId: label.clipId,
    framing: framing.reason,
    crops: label.samples.flatMap((sample) => {
      if (!hasBox(sample)) return [];
      const rect = cropAt(framing.keys, sample.tFrame);
      return [{ tFrame: sample.tFrame, ...pixel(rect) }];
    }),
    centres: Array.from({ length: label.frames }, (_, frame) => {
      const rect = cropAt(framing.keys, frame);
      const box = pixel(rect);
      return { x: box.x + box.w / 2, y: box.y + box.h / 2, w: box.w, h: box.h };
    }),
    qaJitterFrames: qaJitter(framing, label, label.fps),
  };
}

/** One prediction per label, from planVisualFraming on that clip's boxes. */
export function predictReframe(labels: readonly ReframeClipLabel[]): ReframePrediction[] {
  requireSyntheticLabels('reframe', labels, "the mac helper's recorded subject track for each clip");
  return labels.map(predictionFor);
}
