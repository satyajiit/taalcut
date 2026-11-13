// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1-GFX: the graphics lane's view of a timeline, pure. Each motion graphic at its frames on the canvas (a proposal
 * among them, marked), and what a drag on the bed makes of it: the body moves it, an edge trims it, never shorter
 * than half a second or longer than fifteen (core's limits), never off the video; and the graphics.edit payload
 * that says so (a time anchor, and a length when it changed).
 */
import {
  compositionFor,
  graphicWords,
  type FrameRate,
  type GraphicItem,
  type Timeline,
  type TimelineItemId,
} from '@taalcut/core';
import { atRate, fpsOf, toFrames } from './model';

export interface GraphicView {
  readonly item: GraphicItem;
  readonly trackId: string;
  readonly start: number;
  readonly end: number;
  /** Its main words, as written (a counter has none). */
  readonly words: string | null;
  /** HFW1: its composition's name (the designing model's words, shown as written); null for a kit graphic. */
  readonly design: string | null;
  readonly proposed: boolean;
  /** Its row on the lane: graphics at the same time stack, so each can be grabbed. */
  readonly row: number;
}

/** Every motion graphic on the timeline's text tracks, by time, each in the first row free at its time. */
export function graphicViewsOf(timeline: Timeline): GraphicView[] {
  const rate = timeline.canvas.rate;
  const views: Omit<GraphicView, 'row'>[] = [];
  for (const track of timeline.tracks) {
    if (track.kind !== 'text') continue;
    for (const item of track.items) {
      if (item.type !== 'graphic') continue;
      const start = toFrames(item.start, rate);
      views.push({
        item,
        trackId: track.id,
        start,
        end: start + toFrames(item.duration, rate),
        words: graphicWords(item, timeline.graphicCompositions),
        design: item.composition
          ? (compositionFor(item.composition, timeline.graphicCompositions)?.name ?? null)
          : null,
        proposed: item.proposal !== undefined,
      });
    }
  }
  views.sort((a, b) => a.start - b.start || a.end - b.end);
  const ends: number[] = [];
  return views.map((view) => {
    let row = ends.findIndex((end) => end <= view.start);
    if (row < 0) row = ends.length;
    ends[row] = view.end;
    return { ...view, row };
  });
}

/** How many rows the lane needs. */
export const graphicRows = (views: readonly GraphicView[]) =>
  views.reduce((most, view) => Math.max(most, view.row + 1), 0);

export type GraphicDragMode = 'move' | 'start' | 'end';

/** A graphic's length in frames at `rate`: 0.5 to 15 seconds. */
export function lengthLimits(rate: FrameRate): { readonly min: number; readonly max: number } {
  const fps = fpsOf(rate);
  return { min: Math.ceil(fps * 0.5), max: Math.floor(fps * 15) };
}

/** Where a graphic lands after a drag of `delta` frames, kept on the video and within its length limits. */
export function dragged(
  from: { readonly start: number; readonly end: number },
  mode: GraphicDragMode,
  delta: number,
  total: number,
  rate: FrameRate,
): { start: number; end: number } {
  const { min, max } = lengthLimits(rate);
  const end = Math.max(total, from.end);
  if (mode === 'move') {
    const length = from.end - from.start;
    const start = Math.min(Math.max(0, from.start + delta), Math.max(0, end - length));
    return { start, end: start + length };
  }
  if (mode === 'end') {
    const to = Math.min(end, Math.max(from.start + min, Math.min(from.start + max, from.end + delta)));
    return { start: from.start, end: to };
  }
  const to = Math.max(0, Math.max(from.end - max, Math.min(from.end - min, from.start + delta)));
  return { start: to, end: from.end };
}

/** graphics.edit's change for a graphic now at [start, end): a time anchor, and its length if that changed. */
export function dragEdit(
  view: Pick<GraphicView, 'start' | 'end'>,
  to: { readonly start: number; readonly end: number },
  rate: FrameRate,
): { anchor?: { kind: 'time'; at: ReturnType<typeof atRate> }; duration?: ReturnType<typeof atRate> } | null {
  const moved = to.start !== view.start;
  const resized = to.end - to.start !== view.end - view.start;
  if (!moved && !resized) return null;
  return {
    ...(moved || resized ? { anchor: { kind: 'time' as const, at: atRate(to.start, rate) } } : {}),
    ...(resized ? { duration: atRate(to.end - to.start, rate) } : {}),
  };
}

/** The view of a graphic by id. */
export const graphicView = (views: readonly GraphicView[], id: TimelineItemId | null) =>
  id ? (views.find((view) => view.item.id === id) ?? null) : null;
