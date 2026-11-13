// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Where and when each reading lives (FIX-SIGN, SPEC "Scene text is never an overlay"). OCR splits one piece of text
 * into several readings when a person passes in front of it or the light changes: the owner's station sign came out
 * as "TR Line", "19 Line" and "VR Line" at one place, each popping in and out mid-shot like a chat bubble. So the
 * readings at one place in one shot are a site, and each reading's lifetime is judged by its site's:
 *
 * - **misread**: other readings at the site are like it but not it (OCR reads the same thing differently over time,
 *   as it does for text that is partly hidden, at an angle or blurred by the camera);
 * - **interrupted**: the same reading comes back after a gap (something passed in front of it);
 * - **replaced**: unrelated readings follow each other at the place (captions, one line after another);
 * - **lifetime**: the site crosses a cut, lives exactly as long as its shot, or comes and goes mid-shot.
 *
 * Pure: the overlays, the cuts and the reel's length come in.
 */
import { RationalTime, type Box, type FrameRate, type TextOverlay } from '@taalcut/core';
import { boxIou, textSimilarity } from './text-track';

export interface Span {
  readonly start: number;
  readonly end: number;
}

export interface SiteFacts {
  /** The site's index: readings at one place in one shot share it. */
  readonly site: number;
  /** The reading's own frames and its site's (the union of its readings). */
  readonly span: Span;
  readonly siteSpan: Span;
  /** The shot the site starts in. */
  readonly shot: Span;
  /** The reading itself stays across a cut. */
  readonly crosses: boolean;
  /** The site starts with its shot's cut, ends with the next, both, or neither (comes and goes mid-shot). */
  readonly startsWithShot: boolean;
  readonly endsWithShot: boolean;
  /** Under the shortest overlay's time without crossing a cut. */
  readonly short: boolean;
  /** Three or more other readings appear with the same cut, as this one does: a street of billboards. */
  readonly crowd: boolean;
  /** Other readings at the site like this one but not it. */
  readonly misread: number;
  /** The same reading comes back at the site after a gap. */
  readonly interrupted: boolean;
  /** Unrelated readings at the site: a sequence of captions. */
  readonly replaced: number;
}

/** Readings this alike, but under the tracker's "same line", are one text read differently. */
const MISREAD_FLOOR = 0.4;
/** The tracker's "same line" (config.text.similarity). */
const SAME = 0.85;
/** Others appearing with the same cut, beside this one, make a busy street. */
const CROWD = 3;

const spanOf = (overlay: TextOverlay, rate: FrameRate): Span => {
  const start = RationalTime.toFrames(overlay.start, rate);
  return { start, end: start + RationalTime.toFrames(overlay.duration, rate) };
};

/** The shot a frame is in: the last cut at or before it, the first after. */
export function shotAt(frame: number, cuts: readonly number[], total: number): Span {
  const start = Math.max(0, ...cuts.filter((cut) => cut <= frame));
  const end = Math.min(total, ...cuts.filter((cut) => cut > frame));
  return { start, end };
}

/** Two boxes are one place when they overlap well, or one mostly lies inside the other (a word hidden or not). */
export function samePlace(a: Box, b: Box): boolean {
  if (boxIou(a, b) >= 0.3) return true;
  const x = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const smaller = Math.min(a.width * a.height, b.width * b.height);
  return smaller > 0 && (x * y) / smaller >= 0.6;
}

/** Each reading's facts. `cuts` are the frames shots start at (not 0); `near` is the frames a cut's edge allows. */
export function siteFacts(
  overlays: readonly TextOverlay[],
  options: {
    readonly cuts: readonly number[];
    readonly total: number;
    readonly rate: FrameRate;
    readonly near: number;
    readonly minFrames: number;
  },
): SiteFacts[] {
  const { cuts, total, rate, near } = options;
  const spans = overlays.map((overlay) => spanOf(overlay, rate));
  const shots = spans.map((span) => shotAt(span.start, cuts, total));
  // Union-find over readings at one place whose shots are the same.
  const parent = overlays.map((_, index) => index);
  const root = (index: number): number =>
    parent[index] === index ? index : (parent[index] = root(parent[index]!));
  for (let a = 0; a < overlays.length; a++)
    for (let b = a + 1; b < overlays.length; b++)
      if (shots[a]!.start === shots[b]!.start && samePlace(overlays[a]!.box, overlays[b]!.box))
        parent[root(b)] = root(a);
  const members = new Map<number, number[]>();
  overlays.forEach((_, index) => members.set(root(index), [...(members.get(root(index)) ?? []), index]));
  const siteIds = new Map([...members.keys()].map((key, at) => [key, at]));

  return overlays.map((overlay, index) => {
    const group = members.get(root(index))!;
    const span = spans[index]!;
    const siteSpan = {
      start: Math.min(...group.map((at) => spans[at]!.start)),
      end: Math.max(...group.map((at) => spans[at]!.end)),
    };
    const shot = shots[index]!;
    const others = group.filter((at) => at !== index);
    const alike = others.map((at) => textSimilarity(overlay.text, overlays[at]!.text));
    const misread = alike.filter((value) => value >= MISREAD_FLOOR && value < SAME).length;
    const replaced = alike.filter((value) => value < MISREAD_FLOOR).length;
    const interrupted = others.some(
      (at, k) =>
        alike[k]! >= SAME && (spans[at]!.start - span.end > near || span.start - spans[at]!.end > near),
    );
    const crosses = cuts.some((cut) => cut - span.start > near && span.end - cut > near);
    const startsWithShot = siteSpan.start - shot.start <= near;
    const endsWithShot = shotAt(siteSpan.end - 1, cuts, total).end - siteSpan.end <= near;
    const crowd =
      startsWithShot &&
      spans.filter(
        (other, at) =>
          at !== index &&
          !group.includes(at) &&
          shots[at]!.start === shot.start &&
          other.start - shot.start <= near,
      ).length >= CROWD;
    return {
      site: siteIds.get(root(index))!,
      span,
      siteSpan,
      shot,
      crosses,
      startsWithShot,
      endsWithShot,
      short: !crosses && span.end - span.start < options.minFrames,
      crowd,
      misread,
      interrupted,
      replaced,
    };
  });
}
