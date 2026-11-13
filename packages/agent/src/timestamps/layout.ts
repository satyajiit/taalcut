// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Where things sit in time, for resolving references: a template's slots in order, and the clips and gaps on a
 * timeline's main video track (transitions overlap their neighbours, so they take no time of their own). All
 * of it is RationalTime and TimeRange at the video's own rate; frame rules count frames of that rate.
 */
import {
  FrameRate,
  RationalTime,
  TimeRange,
  type SlotId,
  type Template,
  type TemplateSlot,
  type Timeline,
  type TimelineItemId,
} from '@taalcut/core';

/** "the transition at 0:04" finds a cut this close: half a second. */
export const CUT_TOLERANCE = RationalTime.of(1, FrameRate.of(2));
/** A time this many frames (of the video's rate) from a cut is on it. */
export const ON_CUT_FRAMES = 2;

export interface Placed {
  readonly range: TimeRange;
}

export interface SlotSpan extends Placed {
  /** 1-based, in time order. */
  readonly number: number;
  readonly slot: TemplateSlot;
}

export interface ItemSpan extends Placed {
  readonly kind: 'clip' | 'gap' | 'program';
  readonly id: TimelineItemId;
  readonly slotId: SlotId | null;
  /** The transition into this item, if one sits right before it. */
  readonly transitionIn: string | null;
}

/** The instant a span starts, as an empty range: where its cut is. */
export const cutAt = (span: Placed): TimeRange =>
  TimeRange.of(span.range.start, RationalTime.zero(span.range.start.rate));

/** |a − b|. */
export function distance(a: RationalTime, b: RationalTime): RationalTime {
  return RationalTime.isBefore(a, b) ? RationalTime.subtract(b, a) : RationalTime.subtract(a, b);
}

export function slotSpans(template: Template): SlotSpan[] {
  return [...template.slots]
    .sort((a, b) => RationalTime.compare(a.start, b.start))
    .map((slot, i) => ({ number: i + 1, slot, range: TimeRange.of(slot.start, slot.duration) }));
}

/** The timeline's main video track: V1, else its first video track. */
export function mainTrackSpans(timeline: Timeline): ItemSpan[] {
  const tracks = timeline.tracks.filter((track) => track.kind === 'video');
  const track = tracks.find((t) => t.id === 'V1') ?? tracks[0];
  if (!track) return [];
  const spans: ItemSpan[] = [];
  let at = RationalTime.zero(timeline.canvas.rate);
  let transition: string | null = null;
  for (const item of track.items) {
    if (item.type === 'transition') {
      transition = item.kind;
      continue;
    }
    const range = TimeRange.of(at, item.duration);
    spans.push({
      kind: item.type,
      id: item.id,
      slotId: item.slotId,
      range,
      transitionIn: spans.length > 0 ? (transition ?? 'cut') : null,
    });
    at = TimeRange.end(range);
    transition = null;
  }
  return spans;
}

/** Everything the spans cover, from the first start to the last end; undefined with no spans. */
export function extent(spans: readonly Placed[]): TimeRange | undefined {
  const first = spans[0];
  const last = spans.at(-1);
  return first && last ? TimeRange.span(first.range, last.range) : undefined;
}

/**
 * The cut (a span's start; the first span's start is no cut) meant by "the transition at t": one within
 * ON_CUT_FRAMES frames of t is on it; otherwise the nearest within CUT_TOLERANCE.
 */
export function nearestCut<S extends Placed>(spans: readonly S[], t: RationalTime): S | undefined {
  let best: { span: S; off: RationalTime } | undefined;
  for (const span of spans.slice(1)) {
    const off = distance(span.range.start, t);
    const onIt = RationalTime.compare(off, RationalTime.of(ON_CUT_FRAMES, span.range.start.rate)) <= 0;
    if (onIt) return span;
    if (RationalTime.isAfter(off, CUT_TOLERANCE)) continue;
    if (!best || RationalTime.isBefore(off, best.off)) best = { span, off };
  }
  return best?.span;
}
