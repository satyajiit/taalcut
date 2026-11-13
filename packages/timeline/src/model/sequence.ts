// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Reading and rewriting V1, the video sequence. Timeline times are whole
 * frames at the canvas rate (SPEC rule 1), so positions here are plain frame
 * counts; transitions overlap their cut and take no time, as in OTIO.
 */
import {
  RationalTime,
  type Clip,
  type AuthoredProgramItem,
  type FrameRate,
  type Gap,
  type SequenceItem,
  type Timeline,
  type TimelineItemId,
  type Track,
} from '@taalcut/core';

export type VideoTrack = Extract<Track, { kind: 'video' }>;
export type TextTrack = Extract<Track, { kind: 'text' }>;
/** A clip or a gap: what fills a position on V1. */
export type Filler = Clip | Gap | AuthoredProgramItem;

/** One position on V1: the clip or gap there, its index in `items`, and its frames [start, end). */
export interface Position {
  readonly itemIndex: number;
  readonly item: Filler;
  readonly start: number;
  readonly end: number;
}

export function videoTrack(timeline: Timeline): VideoTrack {
  const first = timeline.tracks[0];
  if (first?.kind !== 'video') throw new Error('Timeline has no V1 (the schema guarantees one)');
  return first;
}

export function videoItems(timeline: Timeline): readonly SequenceItem[] {
  return videoTrack(timeline).items;
}

export function positions(items: readonly SequenceItem[]): Position[] {
  const out: Position[] = [];
  let frame = 0;
  items.forEach((item, itemIndex) => {
    if (item.type === 'transition') return;
    out.push({ itemIndex, item, start: frame, end: frame + item.duration.value });
    frame += item.duration.value;
  });
  return out;
}

/** V1's length in frames. */
export function sequenceLength(items: readonly SequenceItem[]): number {
  return items.reduce((sum, item) => (item.type === 'transition' ? sum : sum + item.duration.value), 0);
}

export function withVideoItems(timeline: Timeline, items: SequenceItem[]): Timeline {
  const [first, ...rest] = timeline.tracks;
  if (first?.kind !== 'video') throw new Error('Timeline has no V1');
  return { ...timeline, tracks: [{ ...first, items }, ...rest] };
}

export function findPosition(timeline: Timeline, itemId: TimelineItemId): Position | null {
  return positions(videoItems(timeline)).find((position) => position.item.id === itemId) ?? null;
}

export const frames = (value: number, rate: FrameRate): RationalTime => RationalTime.of(value, rate);

/** The median of V1's clip and gap lengths, standing in for the template's median shot. */
export function medianItemFrames(items: readonly SequenceItem[]): number {
  const lengths = positions(items)
    .map((position) => position.end - position.start)
    .sort((a, b) => a - b);
  if (lengths.length === 0) return 0;
  const middle = Math.floor(lengths.length / 2);
  return lengths.length % 2 === 1
    ? (lengths[middle] ?? 0)
    : ((lengths[middle - 1] ?? 0) + (lengths[middle] ?? 0)) / 2;
}

export function textTracks(timeline: Timeline): TextTrack[] {
  return timeline.tracks.filter((track): track is TextTrack => track.kind === 'text');
}
