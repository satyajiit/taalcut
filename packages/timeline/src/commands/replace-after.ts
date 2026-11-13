// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FRM1-OVL: the placement solver runs again after an edit that changes what an overlay must clear: new words
 * (a bigger or smaller bubble) or another clip under it (other people, elsewhere). Only items the solver placed
 * are moved (their `placement.reason` says so); an item the person placed stays. In the same undo step as the
 * edit. Without a template reader nothing is re-placed; without a subject source the overlays keep the reel's
 * relation with nobody known on screen. Every clip an edit brings in has its track asked for, overlay or not.
 */
import { ok, type AsyncResult, type MediaRef, type TextTrackItem, type Timeline } from '@taalcut/core';
import { EDIT_ENSURE_MS, runPlacement } from '../assembly/placement/run-placement';
import { clipSourceRange, placedClips } from '../assembly/placement/subjects';
import { spansOverlap } from '../assembly/placement/geometry';
import { mediaRef } from '../casting/result';
import type { EditResult, TimelinePart } from '../edits/types';
import type { CommandDeps } from './context';
import { profilesFor } from './resolve';

/** Whether the solver placed the item (and may place it again). */
export function solverPlaced(item: TextTrackItem): boolean {
  if (item.type === 'text') return item.placement !== undefined;
  return typeof item.placement === 'object' && item.placement.reason !== undefined;
}

const textItems = (timeline: Timeline) =>
  timeline.tracks.flatMap((track) => (track.kind === 'text' ? track.items : []));

/** The solver's items with these ids. */
export const placedWith = (timeline: Timeline, ids: readonly string[]) =>
  new Set(
    textItems(timeline)
      .filter((item) => ids.includes(item.id) && solverPlaced(item))
      .map((item) => item.id),
  );

/** The solver's items on screen with any of these clips. */
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
 * next placement, the preview and the export find it tracked. The jobs queue makes them; `runPlacement` waits,
 * bounded, when an item needs them now.
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
 * The edit with the given items placed again; the edit as it was when nothing needs it. `clips` are the clips the
 * edit brought in: placement asks for their tracks, and so does an edit with nothing to place.
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
  const run = await runPlacement(
    edited.timeline,
    template.value,
    {
      ...(deps.subjects ? { subjects: deps.subjects } : {}),
      // An edit waits a little for a new clip's track; render's layout keeps out of heads it finds later.
      ensureBudgetMs: EDIT_ENSURE_MS,
      ...(deps.catalog
        ? {
            media: async (candidates) => {
              const profiles = await profilesFor(deps.catalog, candidates);
              const out = new Map<string, MediaRef>();
              if (profiles.ok) for (const [key, profile] of profiles.value) out.set(key, mediaRef(profile));
              return out;
            },
          }
        : {}),
      ...(deps.casting ? { tau: deps.casting.confidence.tau } : {}),
    },
    ids,
  );
  const recast = run.report.some((entry) => entry.reason === 'recast' || entry.reason === 'retimed');
  const changed = new Set<TimelinePart>([
    ...edited.changed,
    'tracks',
    ...(recast ? (['cast'] as const) : []),
  ]);
  return ok({ timeline: run.timeline, changed: [...changed] });
}
