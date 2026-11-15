// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LONG1: everything but V1 when time is put into the video (a slot lengthened by bars of the music,
 * edits/lengthen.ts). Two frames say where, because the music and the picture take the time at different places:
 *
 * - `at`, the splice: the first frame at or after the point where the music plays its bars again. What follows
 *   the music moves here. Text, graphics and markers that start at or after it are that much later, those that
 *   run across it are that much longer, and those that end before it stay: so a title on a later shot still sits
 *   on it, and one that covered the lengthened shot still covers it. A sound on an audio track keeps its length
 *   (it would need more of its file to run longer) and moves when it starts at or after the frame. The hook
 *   marker keeps its length too. The music bed's window moves its edges the same way.
 * - `picture`, the first frame whose picture is later: the lengthened clip's first frame when the added footage
 *   comes before what it played, the frame after its last when it comes after. What follows the picture moves
 *   here: caption cues (the words of a clip's own sound) and a cover's frame, from this frame on, each whole.
 *
 * The mirror of time-map.ts, which takes time out. Pure; frames are canvas frames.
 */
import {
  RationalTime,
  TimeRange,
  type CaptionTrack,
  type CoverComposition,
  type CoverPictureSource,
  type CoverSettings,
  type Marker,
  type MusicBed,
  type SequenceItem,
  type TextTrackItem,
  type Timeline,
  type TimelineItemId,
  type Track,
} from '@taalcut/core';

export interface Insertion {
  /** The first frame that moves with the music. */
  readonly at: number;
  /** The first frame whose picture moves. */
  readonly picture: number;
  /** How many frames are put in before each. */
  readonly frames: number;
}

/** What an insertion moved, by kind, for the answer of the edit that made it. */
export interface InsertionCount {
  /** Text items and graphics that start later. */
  readonly texts: number;
  /** Text items and graphics that run across the frame and are longer. */
  readonly textsLonger: number;
  /** Caption cues that start later, with their words. */
  readonly captions: number;
  /** Clips on the audio tracks (effects, voice lines) that start later. */
  readonly sounds: number;
  readonly markers: number;
}

type Span = { readonly start: number; readonly end: number };

/** A span after the insertion, and what became of it. */
function inserted(span: Span, insertion: Insertion): Span & { readonly how: 'later' | 'longer' | 'same' } {
  if (span.start >= insertion.at)
    return { start: span.start + insertion.frames, end: span.end + insertion.frames, how: 'later' };
  if (span.end > insertion.at) return { start: span.start, end: span.end + insertion.frames, how: 'longer' };
  return { ...span, how: 'same' };
}

const spanOf = (start: RationalTime, duration: RationalTime): Span => ({
  start: start.value,
  end: start.value + duration.value,
});

function rangeOf(span: Span, rate: RationalTime['rate']): TimeRange {
  return TimeRange.of(RationalTime.of(span.start, rate), RationalTime.of(span.end - span.start, rate));
}

function textItems(items: readonly TextTrackItem[], insertion: Insertion, count: Record<string, number>) {
  return items.map((item): TextTrackItem => {
    const span = inserted(spanOf(item.start, item.duration), insertion);
    if (span.how === 'same') return item;
    count[span.how === 'later' ? 'texts' : 'textsLonger'] =
      (count[span.how === 'later' ? 'texts' : 'textsLonger'] ?? 0) + 1;
    const rate = item.start.rate;
    const moved = {
      ...item,
      start: RationalTime.of(span.start, rate),
      duration: RationalTime.of(span.end - span.start, rate),
    };
    if (moved.type === 'graphic' && moved.anchor.kind === 'time' && moved.anchor.at.value >= insertion.at)
      return {
        ...moved,
        anchor: { kind: 'time', at: RationalTime.of(moved.anchor.at.value + insertion.frames, rate) },
      };
    return moved;
  });
}

/** An audio track with the frames put in as silence before the first sound that starts at or after the frame. */
function audioItems(
  items: readonly SequenceItem[],
  insertion: Insertion,
  ids: () => TimelineItemId,
  count: Record<string, number>,
): SequenceItem[] {
  const out: SequenceItem[] = [];
  let frame = 0;
  let done = false;
  for (const item of items) {
    if (item.type === 'transition') {
      out.push(item);
      continue;
    }
    const start = frame;
    frame += item.duration.value;
    if (!done && start >= insertion.at) {
      done = true;
      const rate = item.duration.rate;
      const before = out.at(-1);
      if (item.type === 'gap') {
        out.push({ ...item, duration: RationalTime.of(item.duration.value + insertion.frames, rate) });
        continue;
      }
      if (before?.type === 'gap') {
        out[out.length - 1] = {
          ...before,
          duration: RationalTime.of(before.duration.value + insertion.frames, rate),
        };
      } else {
        // A transition joined this sound to the one before; with silence between them there is nothing to join.
        if (before?.type === 'transition') out.pop();
        out.push({ type: 'gap', id: ids(), duration: RationalTime.of(insertion.frames, rate), slotId: null });
      }
    }
    if (done && item.type === 'clip') count.sounds = (count.sounds ?? 0) + 1;
    out.push(item);
  }
  return out;
}

function markers(list: readonly Marker[], insertion: Insertion, count: Record<string, number>): Marker[] {
  return list.map((marker) => {
    const rate = marker.range.start.rate;
    const span = spanOf(marker.range.start, marker.range.duration);
    // The hook marker says how long the opening is: it never grows with a shot.
    const next =
      marker.kind === 'hook' && span.start < insertion.at
        ? { ...span, how: 'same' }
        : inserted(span, insertion);
    if (next.how === 'same') return marker;
    if (next.how === 'later') count.markers = (count.markers ?? 0) + 1;
    return { ...marker, range: rangeOf(next, rate) };
  });
}

function captions(track: CaptionTrack | null, insertion: Insertion, count: Record<string, number>) {
  if (!track) return null;
  const later = (range: TimeRange) =>
    TimeRange.of(RationalTime.of(range.start.value + insertion.frames, range.start.rate), range.duration);
  const cues = track.cues.map((cue) => {
    if (cue.range.start.value < insertion.picture) return cue;
    count.captions = (count.captions ?? 0) + 1;
    return {
      ...cue,
      range: later(cue.range),
      words: cue.words.map((word) => ({ ...word, range: later(word.range) })),
    };
  });
  return { ...track, cues };
}

/** A cover keeps its pictures: each frame of the video it names, from `picture` on, is that much later. */
function covers(list: Timeline['covers'], insertion: Insertion): Timeline['covers'] {
  const later = <S extends CoverPictureSource | CoverSettings['source']>(source: S): S =>
    source.kind === 'frame' && source.frame >= insertion.picture
      ? { ...source, frame: source.frame + insertion.frames }
      : source;
  const designed = (composition: CoverComposition): CoverComposition => ({
    ...composition,
    pictures: composition.pictures.map((picture) => ({ ...picture, source: later(picture.source) })),
  });
  return list?.map((cover) => ({
    ...cover,
    source: later(cover.source),
    ...(cover.composition ? { composition: designed(cover.composition) } : {}),
    ...(cover.options ? { options: { ...cover.options, designs: cover.options.designs.map(designed) } } : {}),
  }));
}

/** The person's music window: an edge at or after the frame is later, so the music still ends where it ended. */
function musicBed(bed: MusicBed | undefined, insertion: Insertion): MusicBed | undefined {
  if (!bed) return bed;
  const later = (time: RationalTime) =>
    time.value >= insertion.at ? RationalTime.of(time.value + insertion.frames, time.rate) : time;
  return { ...bed, start: later(bed.start), end: bed.end ? later(bed.end) : null };
}

/** The timeline with every track but V1, the markers, the captions and the music's window through the insertion. */
export function insertTime(
  timeline: Timeline,
  insertion: Insertion,
  ids: () => TimelineItemId,
): { readonly timeline: Timeline; readonly count: InsertionCount } {
  const count: Record<string, number> = {};
  const tracks = timeline.tracks.map((track, index): Track => {
    if (index === 0) return track;
    if (track.kind === 'text') return { ...track, items: textItems(track.items, insertion, count) };
    return { ...track, items: audioItems(track.items, insertion, ids, count) };
  });
  const bed = musicBed(timeline.mix.music, insertion);
  const moved = covers(timeline.covers, insertion);
  return {
    timeline: {
      ...timeline,
      tracks,
      markers: markers(timeline.markers, insertion, count),
      captions: captions(timeline.captions, insertion, count),
      mix: { ...timeline.mix, ...(bed ? { music: bed } : {}) },
      ...(moved ? { covers: moved } : {}),
    },
    count: {
      texts: count.texts ?? 0,
      textsLonger: count.textsLonger ?? 0,
      captions: count.captions ?? 0,
      sounds: count.sounds ?? 0,
      markers: count.markers ?? 0,
    },
  };
}
