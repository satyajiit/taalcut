// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Where things are in a clip, in milliseconds from its start: the clip page's playhead, its shots, what is said
 * and the text on screen. Media time crosses IPC as RationalTime; it becomes milliseconds here, for display and
 * for the playhead only, never to be stored.
 */
import type { AssetDetail, RationalTime } from '@taalcut/core';

type Shot = AssetDetail['shots'][number];
type Line = NonNullable<AssetDetail['transcript']>['lines'][number];

/** A stretch of the clip, end exclusive. */
export interface Span {
  readonly from: number;
  readonly to: number;
}

export interface ShotSpan extends Span {
  readonly shot: Shot;
  /** Its place in the clip, from 0. */
  readonly index: number;
}

export interface TextSpan extends Span {
  readonly text: string;
}

/** Milliseconds in a media time. */
export function msOf(time: Pick<RationalTime, 'value' | 'rate'>): number {
  return (time.value * time.rate.den * 1000) / time.rate.num;
}

function spanOf(range: { start: RationalTime; duration: RationalTime }): Span {
  const from = msOf(range.start);
  return { from, to: from + msOf(range.duration) };
}

/** How long the clip runs: its own duration, else where its last shot or line ends; 0 for a photo. */
export function clipLength(detail: AssetDetail): number {
  if (detail.asset.duration) return msOf(detail.asset.duration);
  if (detail.facts?.duration) return msOf(detail.facts.duration);
  const ends = [
    ...detail.shots.map((shot) => spanOf(shot.range).to),
    ...(detail.transcript?.lines ?? []).map((line) => spanOf(line.range).to),
  ];
  return ends.length > 0 ? Math.max(...ends) : 0;
}

/** The shots in order, each with where it starts and ends. */
export function shotSpans(shots: readonly Shot[]): ShotSpan[] {
  return [...shots]
    .sort((a, b) => a.index - b.index)
    .map((shot, index) => ({ ...spanOf(shot.range), shot, index }));
}

/** The shot the playhead is in: the last one that starts at or before it (the first before any starts). */
export function shotAt(spans: readonly ShotSpan[], at: number): ShotSpan | null {
  let found: ShotSpan | null = spans[0] ?? null;
  for (const span of spans) {
    if (span.from <= at) found = span;
    else break;
  }
  return found;
}

/** Within this much of a shot's start, "previous shot" goes to the one before rather than back to its start. */
const AT_START_MS = 250;

/**
 * Where the previous or next shot starts. Back from inside a shot goes to its start first, as a player's
 * "previous" does; null when there is nowhere to go.
 */
export function stepShot(spans: readonly ShotSpan[], at: number, direction: -1 | 1): number | null {
  const current = shotAt(spans, at);
  if (!current) return null;
  if (direction === 1) return spans[current.index + 1]?.from ?? null;
  if (at - current.from > AT_START_MS) return current.from;
  return spans[current.index - 1]?.from ?? null;
}

/** The line being said at the playhead, by its place in `lines`; null between lines. */
export function lineAt(lines: readonly Pick<Line, 'range'>[], at: number): number | null {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line) continue;
    const span = spanOf(line.range);
    if (span.from <= at && at < span.to) return index;
  }
  return null;
}

/** Does a stretch overlap another (both end exclusive)? */
export function overlaps(a: Span, b: Span): boolean {
  return a.from < b.to && b.from < a.to;
}

/** Each line's stretch and words, for the speech lane. */
export function speechSpans(lines: readonly Pick<Line, 'range' | 'text'>[]): TextSpan[] {
  return lines.map((line) => ({ ...spanOf(line.range), text: line.text }));
}

/** The text on screen across the clip, each once (the same words over the same stretch count once). */
export function textSpans(shots: readonly Shot[]): TextSpan[] {
  const seen = new Set<string>();
  const out: TextSpan[] = [];
  for (const shot of shots)
    for (const text of shot.analysis?.onScreenText ?? []) {
      const span = spanOf(text.range);
      const key = `${text.text}\u0000${Math.round(span.from)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ...span, text: text.text });
    }
  return out.sort((a, b) => a.from - b.from);
}

/** Seconds between the ruler's labels: the first step that gives about six labels or fewer. */
const STEPS_S = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];

/** The ruler's labelled marks (ms), from the first step after 0, leaving room at the end for the last label. */
export function rulerMarks(length: number, labels = 6): number[] {
  if (length <= 0) return [];
  const step = (STEPS_S.find((seconds) => length / 1000 / seconds <= labels) ?? 3600) * 1000;
  const marks: number[] = [];
  for (let at = step; at < length * 0.92; at += step) marks.push(at);
  return marks;
}

/** A playhead position kept inside the clip. */
export function clampTime(at: number, length: number): number {
  return Math.min(Math.max(0, at), Math.max(0, length));
}

/** Milliseconds under a pointer over a box that spans the clip's length. */
export function timeAtX(box: Pick<DOMRect, 'left' | 'width'>, clientX: number, length: number): number {
  if (box.width <= 0) return 0;
  return clampTime(((clientX - box.left) / box.width) * length, length);
}

/** A place in the clip as a fraction of its length, for drawing. */
export function fractionOf(at: number, length: number): number {
  return length > 0 ? Math.min(1, Math.max(0, at / length)) : 0;
}
