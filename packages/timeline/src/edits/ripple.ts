// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Everything but V1 through a time map, for edits that close a hole in the video (P3-B8 drop by ripple, P3-V9
 * cleanup): text items and graphics move and shrink (one inside a removed span goes), markers move (the hook
 * marker stays, at its new place), caption cues move and lose the words inside removed spans, and clips on the
 * audio tracks keep their length and ids and move to where their start went, never overlapping.
 */
import {
  RationalTime,
  TimeRange,
  type CaptionTrack,
  type Marker,
  type SequenceItem,
  type TextTrackItem,
  type Timeline,
  type TimelineItemId,
  type TimeRange as Range,
  type Track,
} from '@taalcut/core';
import { positions } from '../model/sequence';
import { isRemoved, mapFrame, mapSpan, type TimeMap } from './time-map';

type Frames = (time: RationalTime) => number;

function rangeAt(start: number, end: number, rate: RationalTime['rate']): Range {
  return TimeRange.of(RationalTime.of(start, rate), RationalTime.of(Math.max(0, end - start), rate));
}

function textItems(items: readonly TextTrackItem[], map: TimeMap, frames: Frames): TextTrackItem[] {
  return items.flatMap((item) => {
    const rate = item.start.rate;
    const start = frames(item.start);
    const span = mapSpan(map, start, start + frames(item.duration));
    if (span.end - span.start < 1) return [];
    const moved = { ...item, start: RationalTime.of(span.start, rate), duration: RationalTime.of(span.end - span.start, rate) };
    if (moved.type === 'graphic' && moved.anchor.kind === 'time')
      return [{ ...moved, anchor: { kind: 'time' as const, at: RationalTime.of(mapFrame(map, frames(moved.anchor.at)), rate) } }];
    return [moved];
  });
}

/** Clips keep their length; each starts where its old start went, after the clip before. */
function audioItems(items: readonly SequenceItem[], map: TimeMap, ids: () => TimelineItemId): SequenceItem[] {
  const out: SequenceItem[] = [];
  let cursor = 0;
  for (const { item, start, end } of positions(items)) {
    if (item.type !== 'clip') continue;
    const at = Math.max(cursor, mapFrame(map, start));
    if (at > cursor) out.push({ type: 'gap', id: ids(), duration: RationalTime.of(at - cursor, item.duration.rate), slotId: null });
    out.push(item);
    cursor = at + (end - start);
  }
  return out;
}

function markers(list: readonly Marker[], map: TimeMap, frames: Frames): Marker[] {
  return list.flatMap((marker) => {
    const rate = marker.range.start.rate;
    const start = frames(marker.range.start);
    const length = frames(marker.range.duration);
    const span = mapSpan(map, start, start + length);
    if (marker.kind === 'hook') return [{ ...marker, range: rangeAt(span.start, span.start + Math.max(length, 1), rate) }];
    if (length === 0) return isRemoved(map, start) ? [] : [{ ...marker, range: rangeAt(span.start, span.start, rate) }];
    return span.end - span.start < 1 ? [] : [{ ...marker, range: rangeAt(span.start, span.end, rate) }];
  });
}

function captions(track: CaptionTrack | null, map: TimeMap, frames: Frames): CaptionTrack | null {
  if (!track) return null;
  const cues = track.cues.flatMap((cue) => {
    const words = cue.words.flatMap((word) => {
      const start = frames(word.range.start);
      const span = mapSpan(map, start, start + frames(word.range.duration));
      return span.end - span.start < 1 ? [] : [{ ...word, range: rangeAt(span.start, span.end, word.range.start.rate) }];
    });
    if (words.length === 0) return [];
    const start = frames(cue.range.start);
    const span = mapSpan(map, start, start + frames(cue.range.duration));
    return [{ ...cue, words, range: rangeAt(span.start, span.end, cue.range.start.rate) }];
  });
  return { ...track, cues };
}

/** The timeline with every track but V1, the markers and the captions moved through `map`. */
export function rippleExtras(timeline: Timeline, map: TimeMap, ids: () => TimelineItemId): Timeline {
  if (map.removed.length === 0) return timeline;
  const rate = timeline.canvas.rate;
  const frames: Frames = (time) => RationalTime.rescale(time, rate, 'round').value;
  const tracks = timeline.tracks.map((track, index): Track => {
    if (index === 0) return track;
    if (track.kind === 'text') return { ...track, items: textItems(track.items, map, frames) };
    return { ...track, items: audioItems(track.items, map, ids) };
  });
  return { ...timeline, tracks, markers: markers(timeline.markers, map, frames), captions: captions(timeline.captions, map, frames) };
}
