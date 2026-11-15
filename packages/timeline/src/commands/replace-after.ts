// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * After an edit that changes what is under or in a made video's text (new words, another clip): the text nobody
 * placed is laid out again as the reel had it (TXT1, placement/run-placement.ts), in the same undo step as the edit.
 * Only items the layout placed are touched (their `placement` says so); an item a person or the AI placed stays.
 * Without a template reader nothing is laid out again. Every clip an edit brings in has its track asked for, text
 * over it or not.
 */
import { ok, type AsyncResult, type TextTrackItem, type Timeline } from '@taalcut/core';
import { runPlacement } from '../assembly/placement/run-placement';
import { clipSourceRange, placedClips } from '../assembly/placement/subjects';
import { spansOverlap } from '../assembly/placement/geometry';
import type { EditResult, TimelinePart } from '../edits/types';
import type { CommandDeps } from './context';

/** Whether the layout placed the item (and may lay it out again). */
export function solverPlaced(item: TextTrackItem): boolean {
  if (item.type === 'text') return item.placement !== undefined;
  return typeof item.placement === 'object' && item.placement.reason !== undefined;
}

const textItems = (timeline: Timeline) =>
  timeline.tracks.flatMap((track) => (track.kind === 'text' ? track.items : []));

/** The layout's items with these ids. */
export const placedWith = (timeline: Timeline, ids: readonly string[]) =>
  new Set(
    textItems(timeline)
      .filter((item) => ids.includes(item.id) && solverPlaced(item))
      .map((item) => item.id),
  );

/** The layout's items on screen with any of these clips. */
export function placedOver(timeline: Timeline, clipIds: readonly string[]): Set<string> {
  const spans = placedClips(timeline)
    .filter((placed) => clipIds.includes(placed.clip.id))
    .map((placed) => placed.seen);
  return new Set(
    textItems(timeline)
      .filter((item) => solverPlaced(item))
      .filter((item) =>
        spans.some((span) =>
          spansOverlap(span, { start: item.start.value, end: item.start.value + item.duration.value }),
        ),
      )
      .map((item) => item.id),
  );
}

/**
 * Asks for the tracks of these clips' source ranges, without waiting: an edit that brings a clip in (a swap,
 * applyCast, gaps' weak-pick swap) or shows more of one (a trim) asks even when no overlay is over it yet, so the
 * text facts, the preview and the export find it tracked. The jobs queue makes them.
 */
export function requestTracks(deps: CommandDeps, timeline: Timeline, clipIds: readonly string[]): void {
  const source = deps.subjects;
  if (!source || clipIds.length === 0) return;
  const rate = timeline.canvas.rate;
  const ranges = placedClips(timeline).flatMap((placed) =>
    clipIds.includes(placed.clip.id) && placed.clip.media.kind === 'video'
      ? [{ assetId: placed.clip.media.assetId, ...clipSourceRange(placed.clip, rate) }]
      : [],
  );
  if (ranges.length > 0) void source.ensure(ranges).catch(() => undefined);
}

/**
 * The edit with the given items laid out again; the edit as it was when nothing needs it. `clips` are the clips the
 * edit brought in: their tracks are asked for either way.
 */
export async function replaceAfter(
  deps: CommandDeps,
  edited: EditResult,
  ids: ReadonlySet<string>,
  clips: readonly string[] = [],
): AsyncResult<EditResult> {
  const ref = edited.timeline.template;
  const asked = () => {
    requestTracks(deps, edited.timeline, clips);
    return ok(edited);
  };
  if (ids.size === 0 || edited.changed.length === 0 || !deps.templates || !ref) return asked();
  const template = await deps.templates.read(ref);
  // A template that can't be read leaves the boxes where they are, as before FRM1.
  if (!template.ok) return asked();
  const timeline = runPlacement(
    edited.timeline,
    template.value,
    deps.subjects ? { subjects: deps.subjects } : {},
    ids,
  );
  const changed = new Set<TimelinePart>([...edited.changed, 'tracks']);
  return ok({ timeline, changed: [...changed] });
}
