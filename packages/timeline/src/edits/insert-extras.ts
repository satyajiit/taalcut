// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Everything but V1 when `frames` of new video go in at frame `at` (EDT1-OPS: insert, duplicate, a slower clip),
 * the counterpart of ripple.ts's removal: what starts at or after `at` moves later by `frames`, what spans it
 * grows by them, and what ends at or before it stays. Text items, graphics and their time anchors, markers and
 * caption cues and words move so; clips on the audio tracks (voice lines, effects) that start at or after `at`
 * move later and keep their length, one that spans it stays where it is. The music never moves: its beats are the
 * grid the moved cuts re-sync to.
 */
import {
  RationalTime,
  preserveSequenceTransitions as withTransitions,
  TimeRange,
  type CaptionTrack,
  type Marker,
  type SequenceItem,
  type TextTrackItem,
  type Timeline,
  type TimelineItemId,
  type Track,
} from '@taalcut/core';
import { positions } from '../model/sequence';

/** Old frame → new: a start at `at` moves, an end at `at` stays. */
interface Shift {
  readonly at: number;
  readonly frames: number;
}

const startOf = (shift: Shift, frame: number) => (frame >= shift.at ? frame + shift.frames : frame);
const endOf = (shift: Shift, frame: number) => (frame > shift.at ? frame + shift.frames : frame);

function shiftedRange(range: TimeRange, shift: Shift, rate: RationalTime['rate']): TimeRange {
  const start = RationalTime.rescale(range.start, rate, 'round').value;
  const end = start + RationalTime.rescale(range.duration, rate, 'round').value;
  const newStart = startOf(shift, start);
  // An instant (a zero-length marker) moves with its start.
  const newEnd = end === start ? newStart : endOf(shift, end);
  return TimeRange.of(RationalTime.of(newStart, rate), RationalTime.of(Math.max(0, newEnd - newStart), rate));
}

function textItems(
  items: readonly TextTrackItem[],
  shift: Shift,
  rate: RationalTime['rate'],
): TextTrackItem[] {
  return items.map((item) => {
    const range = shiftedRange(TimeRange.of(item.start, item.duration), shift, rate);
    const moved = { ...item, start: range.start, duration: range.duration };
    if (moved.type === 'graphic' && moved.anchor.kind === 'time') {
      const at = RationalTime.rescale(moved.anchor.at, rate, 'round').value;
      return { ...moved, anchor: { kind: 'time' as const, at: RationalTime.of(startOf(shift, at), rate) } };
    }
    return moved;
  });
}

/** Clips that start at or after `at` move later by `frames`: the gap before the first of them grows. */
function audioItems(
  items: readonly SequenceItem[],
  shift: Shift,
  rate: RationalTime['rate'],
  ids: () => TimelineItemId,
): SequenceItem[] {
  const out: SequenceItem[] = [];
  let moved = false;
  for (const { item, start } of positions(items)) {
    if (!moved && item.type === 'clip' && start >= shift.at) {
      moved = true;
      const last = out.at(-1);
      if (last?.type === 'gap')
        out[out.length - 1] = {
          ...last,
          duration: RationalTime.of(last.duration.value + shift.frames, rate),
        };
      else out.push({ type: 'gap', id: ids(), duration: RationalTime.of(shift.frames, rate), slotId: null });
    }
    out.push(item);
  }
  // Transitions on audio tracks keep their place between the same two clips.
  return withTransitions(items, out);
}

export { preserveSequenceTransitions as withTransitions } from '@taalcut/core';

function markers(list: readonly Marker[], shift: Shift, rate: RationalTime['rate']): Marker[] {
  return list.map((marker) => ({ ...marker, range: shiftedRange(marker.range, shift, rate) }));
}

function captions(track: CaptionTrack | null, shift: Shift, rate: RationalTime['rate']): CaptionTrack | null {
  if (!track) return null;
  return {
    ...track,
    cues: track.cues.map((cue) => ({
      ...cue,
      range: shiftedRange(cue.range, shift, rate),
      words: cue.words.map((word) => ({ ...word, range: shiftedRange(word.range, shift, rate) })),
    })),
  };
}

/** The timeline with every track but V1, the markers and the captions moved for `frames` of video at `at`. */
export function insertExtras(
  timeline: Timeline,
  at: number,
  frames: number,
  ids: () => TimelineItemId,
): Timeline {
  if (frames <= 0) return timeline;
  const rate = timeline.canvas.rate;
  const shift = { at, frames };
  const tracks = timeline.tracks.map((track, index): Track => {
    if (index === 0) return track;
    if (track.kind === 'text') return { ...track, items: textItems(track.items, shift, rate) };
    return { ...track, items: audioItems(track.items, shift, rate, ids) };
  });
  return {
    ...timeline,
    tracks,
    markers: markers(timeline.markers, shift, rate),
    captions: captions(timeline.captions, shift, rate),
  };
}
