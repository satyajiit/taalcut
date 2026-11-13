// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What every graphics command shares (SPEC P3.4, HFW1): loading the timeline at the revision it was made on, the
 * words a graphic is timed against, and writing it onto a free text track with `timeline.restore` as the inverse.
 */
import {
  ConflictError,
  err,
  NotFoundError,
  ok,
  PERSON_SOURCES,
  RationalTime,
  TIMELINE_COMMANDS,
  ValidationError,
  type AssetId,
  type AsyncResult,
  type CommandContext,
  type CommandOutcome,
  type GraphicItem,
  type ProjectId,
  type Timeline,
  type TimelineId,
  type TimelineItemId,
  type Track,
  type Transcript,
} from '@taalcut/core';
import { planTimeline } from '../plan/render-plan';
import type { TimelineAccess, TranscriptSource } from '../ports';
import { toFrame } from '../time/frames';
import { transcriptWords, type TimingContext } from './timing';
import { timingContextOf } from './timing-context';

export interface CompositionCommandDeps {
  readonly timelines: TimelineAccess;
  /** Words for timing when a timeline has no captions (the library's stored transcripts). */
  readonly transcripts?: TranscriptSource;
  readonly newItemId?: () => TimelineItemId;
}

/** What placing and editing a graphic return (and the graphics tools report). */
export interface GraphicReceipt {
  readonly timelineId: TimelineId;
  readonly affectedItemIds: string[];
  readonly itemId: TimelineItemId;
  readonly revision: number;
  /** Where the graphic starts, at the timeline's rate. */
  readonly start: RationalTime;
  /** Phrases (or slot ids) the anchor named that weren't found. */
  readonly unmatched: readonly string[];
}

type TextTrack = Extract<Track, { kind: 'text' }>;

export const isPerson = (context: CommandContext) =>
  (PERSON_SOURCES as readonly string[]).includes(context.source);

const isText = (track: Track): track is TextTrack => track.kind === 'text';

/** The tracks with `item` on the first text track free for its frames (a new one when none is). */
export function withGraphicOnTrack(timeline: Timeline, item: GraphicItem): Track[] | null {
  const rate = timeline.canvas.rate;
  const start = toFrame(item.start, rate);
  const end = start + toFrame(item.duration, rate);
  const free = (track: TextTrack) =>
    track.items.every((other) => {
      const otherStart = toFrame(other.start, rate);
      return end <= otherStart || start >= otherStart + toFrame(other.duration, rate);
    });
  const sorted = (items: TextTrack['items']) =>
    [...items].sort((a, b) => RationalTime.compare(a.start, b.start));
  const target = timeline.tracks.find(
    (track): track is TextTrack => isText(track) && track.enabled && free(track),
  );
  if (target)
    return timeline.tracks.map((track) =>
      track === target && isText(track) ? { ...track, items: sorted([...track.items, item]) } : track,
    );
  const used = new Set(timeline.tracks.filter(isText).map((track) => track.id));
  const id = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `T${n}`).find((candidate) => !used.has(candidate));
  if (!id || timeline.tracks.length >= 16) return null;
  const track: TextTrack = { kind: 'text', id, name: 'Graphics', enabled: true, items: [item] };
  return [...timeline.tracks, track];
}

/** The tracks without the item, and the graphic item it was. */
export function withoutGraphic(timeline: Timeline, itemId: string) {
  let found: GraphicItem | undefined;
  const tracks = timeline.tracks.map((track) => {
    if (!isText(track)) return track;
    const item = track.items.find((candidate) => candidate.id === itemId);
    if (item?.type !== 'graphic') return track;
    found = item;
    return { ...track, items: track.items.filter((candidate) => candidate !== item) };
  });
  return { tracks, item: found };
}

/** Removes one or more graphic or text items from text tracks in a single pass. */
export function withoutTextTrackItems(timeline: Timeline, itemIds: readonly string[]) {
  const wanted = new Set(itemIds);
  const removed: string[] = [];
  const tracks = timeline.tracks.map((track) => {
    if (!isText(track)) return track;
    const kept = track.items.filter((candidate) => {
      if (!wanted.has(candidate.id)) return true;
      removed.push(candidate.id);
      return false;
    });
    return kept.length === track.items.length ? track : { ...track, items: kept };
  });
  const foundSet = new Set(removed);
  const missing = itemIds.filter((id) => !foundSet.has(id));
  return { tracks, removedIds: removed, missing };
}

export function graphicWrites(deps: CompositionCommandDeps) {
  async function load(projectId: ProjectId, timelineId: TimelineId, revision: number | undefined) {
    const timeline = await deps.timelines.get(timelineId);
    if (!timeline.ok) return timeline;
    if (timeline.value.projectId !== projectId)
      return err(NotFoundError({ entity: 'timeline', id: timelineId }));
    if (revision !== undefined && revision !== timeline.value.revision)
      return err(ConflictError({ entity: 'timeline', id: timelineId }));
    return timeline;
  }

  /** Caption words, else the transcript through the clips. */
  async function timingFor(timeline: Timeline): AsyncResult<TimingContext> {
    const rate = timeline.canvas.rate;
    const context = timingContextOf(timeline, rate);
    if (context.words.length > 0 || !deps.transcripts) return ok(context);
    const plan = planTimeline(timeline);
    if (!plan.ok) return plan;
    const transcripts = new Map<AssetId, Transcript>();
    for (const assetId of new Set(plan.value.visuals.map((visual) => visual.assetId))) {
      const found = await deps.transcripts.transcript(assetId);
      if (!found.ok) return found;
      if (found.value) transcripts.set(assetId, found.value);
    }
    const language = [...transcripts.values()][0]?.language ?? context.language;
    return ok({ ...context, words: transcriptWords(plan.value, transcripts), language });
  }

  /**
   * Writes the item onto a free text track; the inverse restores the tracks as they were. `prepare` changes the
   * rest of the latest timeline in the same step (a composition joining `graphicCompositions`).
   */
  async function write(
    projectId: ProjectId,
    timeline: Timeline,
    tracks: Timeline['tracks'],
    item: GraphicItem,
    unmatched: readonly string[],
    context: CommandContext,
    prepare: (latest: Timeline) => Timeline = (latest) => latest,
  ): AsyncResult<CommandOutcome<GraphicReceipt>> {
    const placed = withGraphicOnTrack({ ...timeline, tracks }, item);
    if (!placed)
      return err(ValidationError({ field: 'tracks' }, { detail: 'No text track free for the graphic' }));
    const updated = await deps.timelines.update(
      timeline.id,
      (latest) => ({ ...prepare(latest), tracks: placed }),
      context,
    );
    if (!updated.ok) return updated;
    return ok({
      result: {
        timelineId: timeline.id,
        affectedItemIds: [item.id],
        itemId: item.id,
        revision: updated.value.revision,
        start: item.start,
        unmatched,
      },
      inverse: {
        name: TIMELINE_COMMANDS.restore,
        payload: { projectId, timelineId: timeline.id, tracks: timeline.tracks },
      },
    });
  }

  return { load, timingFor, write };
}
