// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A sample's one subject, as the mac helper chooses it (SubjectSelect.swift `chooseSubject`), for tracks made without
 * the helper: each face with the most confident person box it lies in (their union, `union`) or alone (`face`), then
 * people without a face (`human`). The candidate overlapping the previous sample's subject most wins, else the most
 * confident, then the largest. Boxes are fractions of the frame, origin top left. Pure.
 */
import type { FractionBox } from './boxes';

export type ChosenKind = 'face' | 'human' | 'union' | 'none';

export interface ChosenSubject {
  readonly kind: ChosenKind;
  readonly box: FractionBox | null;
  readonly focus: { readonly x: number; readonly y: number } | null;
  readonly confidence: number;
}

interface Scored {
  readonly box: FractionBox;
  readonly confidence: number;
}

const area = (box: FractionBox) => box.width * box.height;
const centre = (box: FractionBox) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
const overlap = (a: FractionBox, b: FractionBox) => {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
};
const iou = (a: FractionBox, b: FractionBox) => {
  const both = overlap(a, b);
  return both > 0 ? both / (area(a) + area(b) - both) : 0;
};
const contains = (box: FractionBox, point: { x: number; y: number }) =>
  point.x >= box.x && point.x <= box.x + box.width && point.y >= box.y && point.y <= box.y + box.height;
const encloses = (outer: FractionBox, inner: FractionBox) =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.width <= outer.x + outer.width &&
  inner.y + inner.height <= outer.y + outer.height;
const union = (a: FractionBox, b: FractionBox): FractionBox => {
  if (encloses(b, a)) return b;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
};

const NONE: ChosenSubject = { kind: 'none', box: null, focus: null, confidence: 0 };

export function chooseSubject(
  faces: readonly Scored[],
  people: readonly Scored[],
  previous: FractionBox | null,
): ChosenSubject {
  const used = new Set<number>();
  const candidates: {
    kind: ChosenKind;
    box: FractionBox;
    focus: { x: number; y: number };
    confidence: number;
  }[] = [];
  for (const face of faces) {
    const focus = centre(face.box);
    let match = -1;
    people.forEach((person, index) => {
      const paired = contains(person.box, focus) || iou(face.box, person.box) > 0;
      if (paired && (match < 0 || person.confidence > people[match]!.confidence)) match = index;
    });
    if (match >= 0) {
      used.add(match);
      candidates.push({
        kind: 'union',
        box: union(face.box, people[match]!.box),
        focus,
        confidence: people[match]!.confidence,
      });
    } else candidates.push({ kind: 'face', box: face.box, focus, confidence: face.confidence });
  }
  people.forEach((person, index) => {
    if (!used.has(index))
      candidates.push({
        kind: 'human',
        box: person.box,
        focus: centre(person.box),
        confidence: person.confidence,
      });
  });
  if (candidates.length === 0) return NONE;
  const better = (a: (typeof candidates)[number], b: (typeof candidates)[number]) =>
    a.confidence !== b.confidence ? a.confidence > b.confidence : area(a.box) > area(b.box);
  let pool = candidates;
  if (previous) {
    const best = Math.max(...candidates.map((candidate) => iou(candidate.box, previous)));
    if (best > 0) pool = candidates.filter((candidate) => iou(candidate.box, previous) === best);
  }
  const chosen = pool.reduce((a, b) => (better(b, a) ? b : a));
  return {
    kind: chosen.kind,
    box: chosen.box,
    focus: chosen.focus,
    confidence: Math.min(1, chosen.confidence),
  };
}
