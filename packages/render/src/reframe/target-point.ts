// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The point the virtual camera follows (SPEC P3.2, "The followed point"), per subject sample, in source pixels.
 *
 * - A face: its centre, so a 9:16 crop keeps the head.
 * - A human box alone: its horizontal centre, a quarter of the way down from its top.
 * - Saliency (no person): its centre.
 * - A tracker sample: the same offset inside the tracked box the point had at the last detection.
 * - Several people: the one overlapping the previous subject, else the most confident, then the largest.
 * - No accepted box for `noBoxSeconds`: the frame centre (the crop eases there under the speed clamp).
 *
 * The person's nudge is added, then the constraints act on the point, before smoothing (after the filter they
 * would bring steps back): the crop stays inside the source, the face lands inside the preset's safe rect and
 * above the caption band along every axis the crop can move. A face too big for that keeps the face; the body
 * clips.
 */
import type { Rect, SubjectSample } from '@taalcut/core';
import type { ReframeConfig } from './config';
import type { SourcePoint, SourceRect } from './framing-types';
import { acceptedBoxes, boxArea, type ScoredBox } from './policy';

export interface FollowedSample {
  /** Output frame from the visual's visible start. */
  readonly frame: number;
  /** The followed point with the nudge, source fractions; null when the crop eases to the centre. */
  readonly raw: SourcePoint | null;
  /** QA's reference box: the face, else the human box (saliency doesn't count). */
  readonly reference: SourceRect | null;
  readonly face: SourceRect | null;
  /** The accepted subject box this sample (for the wide-static area), or null. */
  readonly subject: SourceRect | null;
  /** The body box (human, else face) for the too-tall test, or null. */
  readonly body: SourceRect | null;
}

const centreOf = (box: SourceRect): SourcePoint => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });

const overlapArea = (a: SourceRect, b: SourceRect): number =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

/** Several candidates: the one overlapping the previous subject, else the most confident, then the largest. */
export function pickBox(candidates: readonly ScoredBox[], previous: SourceRect | null): ScoredBox | null {
  if (candidates.length === 0) return null;
  const ranked = [...candidates].sort(
    (a, b) =>
      (previous ? overlapArea(b.box, previous) - overlapArea(a.box, previous) : 0) ||
      b.confidence - a.confidence ||
      boxArea(b.box) - boxArea(a.box),
  );
  return ranked[0] ?? null;
}

const contains = (box: SourceRect, point: SourcePoint) =>
  point.x >= box.x && point.x <= box.x + box.width && point.y >= box.y && point.y <= box.y + box.height;

interface Detection {
  /** What the helper's tracker follows from this detection (its subject box, else ours). */
  readonly tracked: SourceRect;
  readonly point: SourcePoint;
  readonly reference: SourceRect | null;
  readonly face: SourceRect | null;
  readonly subject: SourceRect;
  readonly body: SourceRect | null;
}

function detect(sample: SubjectSample, previous: SourceRect | null, config: ReframeConfig): Detection | null {
  const accepted = acceptedBoxes(sample, config);
  const face = pickBox(accepted.faces, previous);
  if (face) {
    const centre = centreOf(face.box);
    const human = accepted.humans.find((candidate) => contains(candidate.box, centre)) ?? null;
    return {
      tracked: sample.subject.box ?? human?.box ?? face.box,
      point: centre,
      reference: face.box,
      face: face.box,
      subject: human?.box ?? face.box,
      body: human?.box ?? face.box,
    };
  }
  const human = pickBox(accepted.humans, previous);
  if (human) {
    const { box } = human;
    return {
      tracked: sample.subject.box ?? box,
      point: { x: box.x + box.width / 2, y: box.y + box.height * config.humanFocusDrop },
      reference: box,
      face: null,
      subject: box,
      body: box,
    };
  }
  const salient = pickBox(accepted.saliency, previous);
  if (!salient) return null;
  return {
    tracked: sample.subject.box ?? salient.box,
    point: centreOf(salient.box),
    reference: null,
    face: null,
    subject: salient.box,
    body: null,
  };
}

/** `inner` expressed relative to `from`, then placed the same way inside `to`. */
function carryRect(inner: SourceRect, from: SourceRect, to: SourceRect): SourceRect {
  const sx = from.width > 0 ? to.width / from.width : 1;
  const sy = from.height > 0 ? to.height / from.height : 1;
  return {
    x: to.x + (inner.x - from.x) * sx,
    y: to.y + (inner.y - from.y) * sy,
    width: inner.width * sx,
    height: inner.height * sy,
  };
}

function carryPoint(point: SourcePoint, from: SourceRect, to: SourceRect): SourcePoint {
  const box = carryRect({ ...point, width: 0, height: 0 }, from, to);
  return { x: box.x, y: box.y };
}

/** A sample placed on the output frame grid. */
export interface TimedSample {
  readonly frame: number;
  readonly sample: SubjectSample;
}

/**
 * The followed point of every sample, in order. `nudge` is a fraction of the crop size (source fractions
 * `crop`); `fps` turns frames into the no-box timeout.
 */
export function followSamples(
  samples: readonly TimedSample[],
  options: {
    readonly crop: { readonly width: number; readonly height: number };
    readonly nudge: { readonly x: number; readonly y: number };
    readonly fps: number;
    readonly config: ReframeConfig;
  },
): FollowedSample[] {
  const { config, crop, nudge, fps } = options;
  const out: FollowedSample[] = [];
  let last: Detection | null = null;
  let lastSeenFrame = Number.NEGATIVE_INFINITY;
  let held: Omit<FollowedSample, 'frame'> | null = null;
  const nudged = (point: SourcePoint): SourcePoint => ({
    x: point.x + nudge.x * crop.width,
    y: point.y + nudge.y * crop.height,
  });
  for (const { frame, sample } of samples) {
    let found: Omit<FollowedSample, 'frame'> | null = null;
    if (sample.source === 'detect') {
      const detection = detect(sample, last?.reference ?? last?.subject ?? null, config);
      if (detection) {
        last = detection;
        found = {
          raw: nudged(detection.point),
          reference: detection.reference,
          face: detection.face,
          subject: detection.subject,
          body: detection.body,
        };
      }
    } else if (last && sample.subject.box && sample.subject.confidence >= config.trackMinConfidence) {
      const to = sample.subject.box;
      const carry = (box: SourceRect | null) => (box ? carryRect(box, last?.tracked ?? to, to) : null);
      found = {
        raw: nudged(carryPoint(last.point, last.tracked, to)),
        reference: carry(last.reference),
        face: carry(last.face),
        subject: to,
        body: carry(last.body),
      };
    }
    if (found) {
      lastSeenFrame = frame;
      held = found;
      out.push({ frame, ...found });
    } else if (held && (frame - lastSeenFrame) / fps < config.noBoxSeconds) {
      // A short miss holds the last point; it isn't a subject frame for QA.
      out.push({ frame, raw: held.raw, reference: null, face: null, subject: null, body: null });
    } else {
      out.push({ frame, raw: null, reference: null, face: null, subject: null, body: null });
    }
  }
  return out;
}

export interface ConstraintFrame {
  /** Upright source size, pixels. */
  readonly source: { readonly width: number; readonly height: number };
  /** Crop window size, pixels of the source. */
  readonly crop: { readonly width: number; readonly height: number };
  readonly canvas: { readonly width: number; readonly height: number };
  /** The preset's safe rect, canvas pixels. */
  readonly safe: Rect;
  /** Top of the caption band on the canvas, or null without captions. */
  readonly captionBandTop: number | null;
}

/** Narrows `value` into [lo, hi] when that interval exists. */
const into = (value: number, lo: number, hi: number) =>
  lo <= hi ? Math.min(hi, Math.max(lo, value)) : value;

/**
 * The crop centre (source pixels) for a target point (source pixels) and the face (source pixels, or null):
 * the face inside the safe rect and above the caption band where the crop can move, then the crop inside the
 * source.
 */
export function constrainCentre(
  point: SourcePoint,
  face: SourceRect | null,
  frame: ConstraintFrame,
): SourcePoint {
  const { source, crop, canvas, safe } = frame;
  const k = canvas.width / crop.width;
  let x = point.x;
  let y = point.y;
  const canMoveX = crop.width < source.width - 1e-6;
  const canMoveY = crop.height < source.height - 1e-6;
  if (face && canMoveX)
    x = into(
      x,
      face.x + face.width - (safe.x + safe.width) / k + crop.width / 2,
      face.x - safe.x / k + crop.width / 2,
    );
  if (face && canMoveY) {
    const bottom = Math.min(safe.y + safe.height, frame.captionBandTop ?? Number.POSITIVE_INFINITY);
    y = into(y, face.y + face.height - bottom / k + crop.height / 2, face.y - safe.y / k + crop.height / 2);
  }
  return {
    x: Math.min(source.width - crop.width / 2, Math.max(crop.width / 2, x)),
    y: Math.min(source.height - crop.height / 2, Math.max(crop.height / 2, y)),
  };
}
