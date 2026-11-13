// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FRM1-SUB: scoring head boxes and face boxes against the labelled set. A labelled head is **found** when one
 * predicted head box covers at least 80% of it and is no more than 2.5 times its area: the keep-out covers the
 * head, and isn't the whole frame. Each prediction finds at most one head (greedy, best coverage first). A labelled
 * face (a head whose face is frontal or in profile) is found when a predicted face box's centre lies inside the
 * head and the face box is no bigger than the head. Ignored heads count neither way. Pure.
 */

export interface FractionBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type FaceVisibility = 'frontal' | 'profile' | 'none';

export interface LabelledHead {
  readonly box: FractionBox;
  readonly face: FaceVisibility;
  readonly tags?: readonly string[];
  readonly ignore?: boolean;
}

export interface LabelledFrame {
  readonly heads: readonly LabelledHead[];
  readonly notes?: string;
}

/** One detector's boxes on one frame. */
export interface FramePrediction {
  readonly heads: readonly FractionBox[];
  readonly faces: readonly FractionBox[];
}

export const HEAD_MATCH = { minCoverage: 0.8, maxAreaRatio: 2.5 } as const;

const area = (box: FractionBox) => Math.max(0, box.width) * Math.max(0, box.height);

export function intersection(a: FractionBox, b: FractionBox): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

export function iou(a: FractionBox, b: FractionBox): number {
  const both = intersection(a, b);
  const union = area(a) + area(b) - both;
  return union > 0 ? both / union : 0;
}

/** How much of `truth` the prediction covers (0–1). */
export const coverage = (truth: FractionBox, predicted: FractionBox): number =>
  area(truth) > 0 ? intersection(truth, predicted) / area(truth) : 0;

export function headMatches(truth: FractionBox, predicted: FractionBox): boolean {
  return (
    coverage(truth, predicted) >= HEAD_MATCH.minCoverage &&
    area(predicted) <= HEAD_MATCH.maxAreaRatio * area(truth)
  );
}

/** Greedy one-to-one matching: for each labelled head, whether a prediction found it, and which. */
export function matchHeads(
  truth: readonly FractionBox[],
  predicted: readonly FractionBox[],
): { found: boolean[]; used: boolean[]; iou: number[] } {
  const pairs: { t: number; p: number; score: number }[] = [];
  truth.forEach((head, t) =>
    predicted.forEach((box, p) => {
      if (headMatches(head, box)) pairs.push({ t, p, score: coverage(head, box) + iou(head, box) });
    }),
  );
  pairs.sort((a, b) => b.score - a.score);
  const found = truth.map(() => false);
  const used = predicted.map(() => false);
  const ious = truth.map(() => 0);
  for (const pair of pairs) {
    if (found[pair.t] || used[pair.p]) continue;
    found[pair.t] = true;
    used[pair.p] = true;
    ious[pair.t] = iou(truth[pair.t]!, predicted[pair.p]!);
  }
  return { found, used, iou: ious };
}

const centreInside = (box: FractionBox, inside: FractionBox) => {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  return cx >= inside.x && cx <= inside.x + inside.width && cy >= inside.y && cy <= inside.y + inside.height;
};

export interface Miss {
  readonly frame: string;
  readonly head: number;
  readonly face: FaceVisibility;
  readonly tags: readonly string[];
}

export interface SubjectScore {
  readonly frames: number;
  readonly heads: { readonly total: number; readonly found: number; readonly recall: number; readonly meanIou: number };
  /** Predicted heads that match no labelled head (ignored heads aside), per frame. */
  readonly falseHeadsPerFrame: number;
  readonly faces: { readonly total: number; readonly found: number; readonly recall: number };
  /** Recall by tag and face visibility. */
  readonly byKind: Readonly<Record<string, { readonly total: number; readonly found: number }>>;
  readonly headMisses: readonly Miss[];
  readonly faceMisses: readonly Miss[];
}

export function scoreSubjects(
  labels: Readonly<Record<string, LabelledFrame>>,
  predictions: Readonly<Record<string, FramePrediction>>,
): SubjectScore {
  let total = 0;
  let found = 0;
  let iouSum = 0;
  let falseHeads = 0;
  let faceTotal = 0;
  let faceFound = 0;
  const byKind: Record<string, { total: number; found: number }> = {};
  const count = (key: string, hit: boolean) => {
    const entry = (byKind[key] ??= { total: 0, found: 0 });
    entry.total += 1;
    if (hit) entry.found += 1;
  };
  const headMisses: Miss[] = [];
  const faceMisses: Miss[] = [];
  const ids = Object.keys(labels).sort();
  for (const id of ids) {
    const frame = labels[id]!;
    const predicted = predictions[id] ?? { heads: [], faces: [] };
    const all = frame.heads.map((head) => head.box);
    const match = matchHeads(all, predicted.heads);
    frame.heads.forEach((head, index) => {
      if (head.ignore) return;
      const hit = match.found[index]!;
      total += 1;
      if (hit) {
        found += 1;
        iouSum += match.iou[index]!;
      } else headMisses.push({ frame: id, head: index, face: head.face, tags: head.tags ?? [] });
      count(`face:${head.face}`, hit);
      for (const tag of head.tags ?? []) count(`tag:${tag}`, hit);
      if (head.face === 'none') return;
      faceTotal += 1;
      const faceHit = predicted.faces.some(
        (face) => centreInside(face, head.box) && area(face) <= area(head.box) * 1.05,
      );
      if (faceHit) faceFound += 1;
      else faceMisses.push({ frame: id, head: index, face: head.face, tags: head.tags ?? [] });
    });
    // A prediction is false when it matches no head and doesn't sit mostly on an ignored or labelled head.
    predicted.heads.forEach((box, p) => {
      if (match.used[p]) return;
      const onHead = frame.heads.some((head) => intersection(head.box, box) >= 0.5 * area(box));
      if (!onHead) falseHeads += 1;
    });
  }
  return {
    frames: ids.length,
    heads: { total, found, recall: total > 0 ? found / total : 0, meanIou: found > 0 ? iouSum / found : 0 },
    falseHeadsPerFrame: ids.length > 0 ? falseHeads / ids.length : 0,
    faces: { total: faceTotal, found: faceFound, recall: faceTotal > 0 ? faceFound / faceTotal : 0 },
    byKind,
    headMisses,
    faceMisses,
  };
}
