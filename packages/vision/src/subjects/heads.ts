// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Whole heads from the no-helper detector's poses and people (FRM1-SUB), the same idea as the mac helper's
 * Heads.swift `headOfPose`, with proportions fitted to RTMO's COCO keypoints on the labelled subjects set (tools/evals
 * `eval:subjects`, 90 frames):
 * - a pose's head is centred on its head keypoints (nose, eyes, ears). Its height is the larger of what the face says
 *   (the ears' or the eyes' spread, the smaller of the two: a turned face narrows both) and what the body says (the
 *   head keypoints' height over the shoulders, the shoulders' spread, the larger: a side-on body narrows the
 *   shoulders). A profile's head reaches behind the face towards its one ear. Seen from behind as from the front;
 * - a person box with no head in the top half gets a head at its top: a share of the box's width, square in pixels,
 *   no taller than a share of the box;
 * - a pose with its nose or an eye showing has a face: its head's box shrunk about those keypoints.
 * People are the person boxes, each reaching over the heads on it. Boxes are fractions of the frame, origin top left.
 */
import type { FractionBox } from './boxes';
import type { DetectedFace, DetectedPose, FrameSubjects, PoseKeypoint } from './found';
import { SUBJECT_TUNING } from './model';

export const ONNX_HEAD_PROPORTIONS = {
  /** The ears' spread and the eyes' spread, in head heights (pixels). */
  ears: 0.63,
  eyes: 0.26,
  /** The head keypoints' height over the shoulders' midpoint, and the shoulders' spread, in head heights. */
  neck: 0.8,
  shoulders: 1.4,
  /** The head's height is grown by this. */
  grow: 1.1,
  /** The head keypoints' mean sits this far below the head's top, in head heights. */
  top: 0.6,
  /** The head's pixel width over its height. */
  width: 1.12,
  /** A profile's head centre behind its face keypoints, towards its one ear, in head widths. */
  turn: 0.1,
  /** A face: the head shrunk to this share of it, about the face's keypoints. */
  face: 0.6,
  /** A person's head: this share of the box's width, its pixel height over width, at most this share of the box. */
  personWidth: 0.35,
  personAspect: 1,
  personMaxShare: 0.25,
} as const;

export interface ScoredBox {
  readonly box: FractionBox;
  readonly confidence: number;
}

type Edges = { x0: number; y0: number; x1: number; y1: number };

const edges = (box: FractionBox): Edges => ({
  x0: box.x,
  y0: box.y,
  x1: box.x + box.width,
  y1: box.y + box.height,
});
const unit = (value: number) => Math.min(1, Math.max(0, value));
const boxOf = (e: Edges): FractionBox => {
  const x0 = unit(e.x0);
  const y0 = unit(e.y0);
  return { x: x0, y: y0, width: Math.max(0, unit(e.x1) - x0), height: Math.max(0, unit(e.y1) - y0) };
};
const area = (e: Edges) => Math.max(0, e.x1 - e.x0) * Math.max(0, e.y1 - e.y0);
const overlap = (a: Edges, b: Edges) => {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  return w > 0 && h > 0 ? w * h : 0;
};
const mean = (points: readonly PoseKeypoint[]) => ({
  x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
  y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
  score: points.reduce((sum, p) => sum + p.score, 0) / points.length,
});

/** COCO's keypoint indices. */
const NOSE = 0;
const EYES = [1, 2] as const;
const EARS = [3, 4] as const;
const SHOULDERS = [5, 6] as const;

/** A pose's head; null without a head keypoint or anything to size it by. */
export function headOfPose(
  pose: Pick<DetectedPose, 'keypoints'>,
  aspect: number,
  least: number,
): { readonly box: FractionBox; readonly confidence: number } | null {
  const p = ONNX_HEAD_PROPORTIONS;
  const seen = (index: number) => {
    const point = pose.keypoints[index];
    return point && point.score >= least ? [point] : [];
  };
  const head = [NOSE, ...EYES, ...EARS].flatMap(seen);
  if (head.length === 0) return null;
  const at = mean(head);
  const spread = (pair: readonly PoseKeypoint[]) => Math.abs(pair[0]!.x - pair[1]!.x) * aspect;
  const ears = EARS.flatMap(seen);
  const eyes = EYES.flatMap(seen);
  const shoulders = SHOULDERS.flatMap(seen);
  const byFace = [
    ...(ears.length === 2 ? [spread(ears) / p.ears] : []),
    ...(eyes.length === 2 ? [spread(eyes) / p.eyes] : []),
  ];
  const byBody: number[] = [];
  if (shoulders.length === 2) {
    const neck = (shoulders[0]!.y + shoulders[1]!.y) / 2;
    if (neck > at.y) byBody.push((neck - at.y) / p.neck);
    byBody.push(spread(shoulders) / p.shoulders);
  }
  const height =
    Math.max(byBody.length > 0 ? Math.max(...byBody) : 0, byFace.length > 0 ? Math.min(...byFace) : 0) *
    p.grow;
  if (!(height > 0)) return null;
  const width = (p.width * height) / aspect;
  let cx = at.x;
  const face = [NOSE, ...EYES].flatMap(seen);
  if (ears.length === 1 && face.length > 0) cx += Math.sign(ears[0]!.x - mean(face).x) * p.turn * width;
  const top = at.y - p.top * height;
  return {
    box: boxOf({ x0: cx - width / 2, y0: top, x1: cx + width / 2, y1: top + height }),
    confidence: Math.min(1, at.score),
  };
}

/** A pose's face, when its nose or an eye shows: its head shrunk about those keypoints. */
export function faceOfPose(
  pose: DetectedPose,
  frame: { readonly width: number; readonly height: number },
  tuning: { readonly keypointScore: number; readonly faceKeypointScore: number },
): DetectedFace | null {
  const shown = [NOSE, ...EYES].flatMap((index) => {
    const point = pose.keypoints[index];
    return point && point.score >= tuning.faceKeypointScore ? [point] : [];
  });
  if (shown.length === 0) return null;
  const head = headOfPose(pose, frame.width / Math.max(1, frame.height), tuning.keypointScore);
  if (!head) return null;
  const at = mean(shown);
  const share = ONNX_HEAD_PROPORTIONS.face;
  const width = head.box.width * share;
  const height = head.box.height * share;
  return {
    box: boxOf({ x0: at.x - width / 2, y0: at.y - height / 2, x1: at.x + width / 2, y1: at.y + height / 2 }),
    confidence: Math.min(1, at.score),
  };
}

/** A head at the top of a person box; `aspect` is the frame's width over its height. */
export function headOfPerson(person: FractionBox, aspect: number): FractionBox {
  const p = ONNX_HEAD_PROPORTIONS;
  let width = p.personWidth * person.width;
  let height = width * aspect * p.personAspect;
  if (height > p.personMaxShare * person.height) {
    height = p.personMaxShare * person.height;
    width = height / (aspect * p.personAspect);
  }
  const cx = person.x + person.width / 2;
  return boxOf({ x0: cx - width / 2, y0: person.y, x1: cx + width / 2, y1: person.y + height });
}

/** At most 16 heads and 16 people, as the subject track holds. */
export function headsFrom(
  subjects: FrameSubjects,
  frame: { readonly width: number; readonly height: number },
  least = SUBJECT_TUNING.keypointScore,
): { readonly heads: ScoredBox[]; readonly people: ScoredBox[] } {
  const aspect = frame.width / Math.max(1, frame.height);
  const heads: ScoredBox[] = [];
  const taken = (box: FractionBox) =>
    heads.some(
      (other) =>
        overlap(edges(other.box), edges(box)) > 0.3 * Math.min(area(edges(box)), area(edges(other.box))),
    );
  for (const pose of subjects.poses ?? []) {
    const head = headOfPose(pose, aspect, least);
    if (head && !taken(head.box)) heads.push(head);
  }
  const bodies = [...subjects.people, ...(subjects.poses ?? [])];
  for (const person of bodies) {
    const body = edges(person.box);
    const top = { ...body, y1: body.y0 + (body.y1 - body.y0) / 2 };
    // A head in the top half of the box is this person's.
    if (heads.some((head) => overlap(edges(head.box), top) > 0.2 * area(edges(head.box)))) continue;
    const head = headOfPerson(person.box, aspect);
    if (taken(head)) continue;
    heads.push({ box: head, confidence: person.confidence * 0.8 });
  }
  const people: ScoredBox[] = [];
  for (const person of bodies) {
    let body = edges(person.box);
    if (
      people.some(
        (kept) => overlap(edges(kept.box), body) > 0.6 * Math.min(area(edges(kept.box)), area(body)),
      )
    )
      continue;
    for (const head of heads) {
      const e = edges(head.box);
      if (overlap(body, e) > 0.5 * area(e))
        body = {
          x0: Math.min(body.x0, e.x0),
          y0: Math.min(body.y0, e.y0),
          x1: Math.max(body.x1, e.x1),
          y1: Math.max(body.y1, e.y1),
        };
    }
    people.push({ box: boxOf(body), confidence: person.confidence });
  }
  return { heads: heads.slice(0, 16), people: people.slice(0, 16) };
}
