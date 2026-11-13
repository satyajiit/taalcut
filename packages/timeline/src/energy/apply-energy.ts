// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * timeline.applyEnergyCurve's pure edit (P3-V12): the timeline rebased onto the template version the curve made.
 * V1 and the cast as rebase-video.ts places them; text from the template follows its overlay (the template half
 * moved each overlay to the slot holding its start), other text keeps its time and takes its slot's first new
 * slot; the hook marker follows the new version's hook, and the notes on the changed slots go with them (a new
 * pick with no motion peak on its beat gets the usual one). `timeline.template` names the new version.
 */
import {
  newId,
  ok,
  RationalTime,
  TimeRange,
  type CastCandidate,
  type EnergySlotMap,
  type Marker,
  type MediaRef,
  type Result,
  type Template,
  type TextTrackItem,
  type Timeline,
  type TimelineItemId,
} from '@taalcut/core';
import type { EditOptions, EditResult } from '../edits/types';
import { marker, MARKER_LABELS } from '../model/markers';
import { positions, sequenceLength, textTracks, videoItems, withVideoItems } from '../model/sequence';
import { fitTransitions, repack } from '../resync/neighbours';
import { rebaseVideo } from './rebase-video';

export interface EnergyRebase {
  /** The new template version. */
  readonly template: Template;
  readonly slotMap: EnergySlotMap;
  readonly picks: ReadonlyMap<string, CastCandidate>;
  readonly media: ReadonlyMap<string, MediaRef>;
}

/** Labels of the markers the timeline writes about a slot's clip; they go when the slot changes. */
const SLOT_NOTES = new Set<string>([MARKER_LABELS.noSyncPoint, MARKER_LABELS.noHandle, MARKER_LABELS.offBeat]);

function clampTo<T extends { readonly start: RationalTime; readonly duration: RationalTime }>(
  item: T,
  length: number,
): T | null {
  if (item.start.value >= length) return null;
  const end = Math.min(item.start.value + item.duration.value, length);
  if (end === item.start.value + item.duration.value) return item;
  return { ...item, duration: RationalTime.of(end - item.start.value, item.duration.rate) };
}

function rebaseText(timeline: Timeline, rebase: EnergyRebase, length: number): Timeline['tracks'] {
  const overlays = new Map(rebase.template.text.map((overlay) => [overlay.id as string, overlay]));
  const firstNew = new Map<string, EnergySlotMap[number]['slotId']>();
  for (const entry of rebase.slotMap) for (const from of entry.from) if (!firstNew.has(from)) firstNew.set(from, entry.slotId);
  const moved = (item: TextTrackItem): TextTrackItem | null => {
    if (item.type !== 'text') return clampTo(item, length);
    const overlay = item.overlayId && item.origin !== 'user' ? overlays.get(item.overlayId) : undefined;
    if (overlay) return clampTo({ ...item, start: overlay.start, duration: overlay.duration, slotId: overlay.slotId }, length);
    const slotId = item.slotId ? (firstNew.get(item.slotId) ?? item.slotId) : null;
    return clampTo({ ...item, slotId }, length);
  };
  const text = textTracks(timeline).map((track) => ({
    ...track,
    items: track.items.flatMap((item) => moved(item) ?? []),
  }));
  return [...timeline.tracks.filter((track) => track.kind !== 'text'), ...repack(text)];
}

interface MarkerRebase {
  readonly changed: ReadonlySet<string>;
  /** The new version's hook, in frames. */
  readonly hookEnd: number;
  readonly ids: () => TimelineItemId;
}

function rebaseMarkers(timeline: Timeline, next: Timeline, { changed, hookEnd: hookFrames, ids }: MarkerRebase): Marker[] {
  const rate = timeline.canvas.rate;
  const placed = positions(videoItems(next));
  const length = placed.at(-1)?.end ?? 0;
  const spans = placed.filter((position) => position.item.slotId && changed.has(position.item.slotId));
  const inChanged = (frame: number) => spans.some((span) => frame >= span.start && frame < span.end);
  const kept = timeline.markers.flatMap((item) => {
    if (item.kind === 'hook' && item.label === MARKER_LABELS.hook) return [];
    if (SLOT_NOTES.has(item.label) && inChanged(item.range.start.value)) return [];
    const range = clampTo({ start: item.range.start, duration: item.range.duration }, length);
    return range ? [{ ...item, range: TimeRange.of(range.start, range.duration) }] : [];
  });
  const notes = spans.flatMap(({ item, start }) =>
    item.type === 'clip' && item.beatAnchor && item.syncPoint === null && item.media.kind === 'video'
      ? [marker(ids(), 'qa', MARKER_LABELS.noSyncPoint, start, 1, rate)]
      : [],
  );
  const hookEnd = Math.min(hookFrames, length);
  const hook = timeline.markers.some((item) => item.kind === 'hook') && hookEnd > 0;
  return [...(hook ? [marker(ids(), 'hook', MARKER_LABELS.hook, 0, hookEnd, rate)] : []), ...kept, ...notes].sort(
    (a, b) => a.range.start.value - b.range.start.value,
  );
}

export function applyEnergy(timeline: Timeline, rebase: EnergyRebase, options: EditOptions): Result<EditResult> {
  const ids = options.ids ?? (() => newId<'TimelineItem'>());
  const video = rebaseVideo({
    items: videoItems(timeline),
    cast: timeline.cast?.slots ?? [],
    template: rebase.template,
    slotMap: rebase.slotMap,
    picks: rebase.picks,
    media: rebase.media,
    source: options.source,
    ids,
  });
  if (!video.ok) return video;
  const rate = timeline.canvas.rate;
  const items = fitTransitions(video.value.items, rate);
  const length = sequenceLength(items);
  const cast = timeline.cast ? { ...timeline.cast, slots: video.value.cast } : null;
  const placed = withVideoItems(
    { ...timeline, cast, template: { id: rebase.template.id, version: rebase.template.version } },
    items,
  );
  const next: Timeline = {
    ...placed,
    tracks: rebaseText(placed, rebase, length),
    markers: rebaseMarkers(timeline, placed, {
      changed: video.value.changed,
      hookEnd: rebase.template.pacing.hookEnd.value,
      ids,
    }),
  };
  return ok({ timeline: next, changed: ['tracks', 'markers', 'cast', 'template'] });
}
