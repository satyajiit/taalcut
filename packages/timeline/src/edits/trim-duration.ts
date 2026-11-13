// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * timeline.trimToDuration (P2-M8, render QA's too-long fix): the video ends
 * at most `maxSeconds` in, cut from its end. The new end is the latest grid
 * point (beat or half beat) at or before the limit within the re-sync reach
 * that leaves the last clip at least `minClipFrames` long; without one, the
 * limit itself, marked off the beat. The clip crossing it ripples shorter;
 * clips and gaps wholly past it go, their cast slots keeping their note with
 * `clipId: null`; transitions into them go; text, markers and caption cues
 * past the end go and the ones crossing it are cut to it. Never longer than
 * the limit, so the QA check that asked for it passes.
 */
import {
  err,
  newId,
  ok,
  RationalTime,
  TimeRange,
  type CaptionTrack,
  type Marker,
  type Result,
  type SequenceItem,
  type Timeline,
  type Track,
} from '@taalcut/core';
import { InvalidMove } from '../errors';
import { trimEnd } from '../model/clip-edit';
import { EDIT_CONFIG } from '../model/config';
import { marker, MARKER_LABELS } from '../model/markers';
import { medianItemFrames, positions, videoItems, withVideoItems, type Position } from '../model/sequence';
import { beatGrid, isOnGrid } from '../resync/grid';
import { resync } from '../resync/resync';
import { refuseLocked, unchanged, type EditOptions, type EditResult, type TimelinePart } from './types';

export interface TrimToDurationInput {
  readonly maxSeconds: number;
}

/** Whole canvas frames in `seconds`, rounded down (a tiny epsilon keeps 179 s at 30 fps exactly 5370). */
function framesIn(seconds: number, rate: Timeline['canvas']['rate']): number {
  return Math.floor((seconds * rate.num) / rate.den + 1e-9);
}

/** Can the video end at `end`: the item it cuts keeps enough frames (a clip `minClip`, a gap one). */
function endFits(all: readonly Position[], end: number, minClip: number): boolean {
  if (end < 1) return false;
  const cut = all.find((position) => position.start < end && position.end > end);
  if (!cut) return true;
  return end - cut.start >= (cut.item.type === 'clip' ? minClip : 1);
}

/** The new end: the latest fitting grid point within reach of the limit, else the latest fitting frame. */
function chooseEnd(
  timeline: Timeline,
  all: readonly Position[],
  limit: number,
  minClip: number,
  searchBeats: number,
) {
  const grid = beatGrid(timeline.beatMap, timeline.canvas.rate, medianItemFrames(videoItems(timeline)));
  if (grid.points && grid.interval !== null) {
    const reach = grid.interval * searchBeats;
    const points = grid.points.filter((point) => point <= limit && point >= limit - reach).reverse();
    const onBeat = points.find((point) => endFits(all, point, minClip));
    if (onBeat !== undefined) return { end: onBeat, onGrid: true };
  }
  // No grid point in reach: the limit, or the start of the clip it would leave too short.
  let end = limit;
  while (end > 0 && !endFits(all, end, minClip)) {
    end = all.find((position) => position.start < end && position.end > end)?.start ?? end - 1;
  }
  return { end, onGrid: isOnGrid(grid, end) };
}

/** V1 cut at `end`: the crossing item shorter, the rest past it gone, transitions only between kept clips. */
function cutSequence(timeline: Timeline, end: number): { items: SequenceItem[]; dropped: Set<string> } {
  const rate = timeline.canvas.rate;
  const source = videoItems(timeline);
  const kept: SequenceItem[] = [];
  const dropped = new Set<string>();
  let frame = 0;
  for (const item of source) {
    if (item.type === 'transition') {
      kept.push(item);
      continue;
    }
    const start = frame;
    frame += item.duration.value;
    if (frame <= end) kept.push(item);
    else if (start < end) kept.push(trimEnd(item, end - frame, rate));
    else dropped.add(item.id);
  }
  // A transition goes when either neighbour went (re-sync's fitTransitions clamps the rest).
  const items = kept.filter((item, index) => {
    if (item.type !== 'transition') return true;
    const before = kept[index - 1];
    const after = kept[index + 1];
    return before?.type === 'clip' && after?.type === 'clip';
  });
  return { items, dropped };
}

/** A span kept inside [0, end): null when it starts at or after the end, else cut to it. */
function within(range: TimeRange, end: number): TimeRange | null {
  const start = range.start.value;
  if (start >= end) return null;
  const length = Math.min(range.duration.value, end - start);
  return length === range.duration.value
    ? range
    : TimeRange.of(range.start, RationalTime.of(length, range.start.rate));
}

function cutText(tracks: readonly Track[], end: number): Track[] {
  return tracks.map((track) => {
    if (track.kind !== 'text') return track;
    const items = track.items.flatMap((item) => {
      const range = within(TimeRange.of(item.start, item.duration), end);
      return range ? [{ ...item, duration: range.duration }] : [];
    });
    return { ...track, items };
  });
}

function cutMarkers(markers: readonly Marker[], end: number): Marker[] {
  return markers.flatMap((item) => {
    const range = within(item.range, end);
    return range ? [{ ...item, range }] : [];
  });
}

function cutCaptions(captions: CaptionTrack | null, end: number): CaptionTrack | null {
  if (!captions) return null;
  const cues = captions.cues.flatMap((cue) => {
    const range = within(cue.range, end);
    if (!range) return [];
    const words = cue.words.flatMap((word) => {
      const kept = within(word.range, range.start.value + range.duration.value);
      return kept ? [{ ...word, range: kept }] : [];
    });
    return words.length > 0 ? [{ ...cue, range, words }] : [];
  });
  return { ...captions, cues };
}

export function trimToDuration(
  timeline: Timeline,
  input: TrimToDurationInput,
  options: EditOptions,
): Result<EditResult> {
  const rate = timeline.canvas.rate;
  const config = options.config ?? EDIT_CONFIG;
  const all = positions(videoItems(timeline));
  const length = all.at(-1)?.end ?? 0;
  const limit = framesIn(input.maxSeconds, rate);
  if (length <= limit) return unchanged(timeline);
  if (limit < 1) return err(InvalidMove(undefined, { detail: 'The limit is under one frame' }));
  const { end, onGrid } = chooseEnd(timeline, all, limit, config.minClipFrames, config.searchBeats);
  if (end < 1) return err(InvalidMove(undefined, { detail: 'Nothing would be left of the video' }));
  for (const position of all.filter((p) => p.end > end)) {
    const allowed = refuseLocked(position.item, options.source);
    if (!allowed.ok) return allowed;
  }

  const { items, dropped } = cutSequence(timeline, end);
  const cast = timeline.cast
    ? {
        ...timeline.cast,
        slots: timeline.cast.slots.map((slot) =>
          slot.clipId && dropped.has(slot.clipId) ? { ...slot, clipId: null } : slot,
        ),
      }
    : null;
  const castChanged = JSON.stringify(cast) !== JSON.stringify(timeline.cast);
  const markers = cutMarkers(timeline.markers, end);
  // The end fell between beats (no grid point left the last clip long enough): say so, as a moved cut would.
  if (!onGrid && timeline.beatMap) {
    const ids = options.ids ?? (() => newId<'TimelineItem'>());
    markers.push(marker(ids(), 'qa', MARKER_LABELS.offBeat, end - 1, 1, rate));
  }
  const cutVideo = withVideoItems(timeline, items);
  const captions = cutCaptions(timeline.captions, end);
  const cutDoc: Timeline = { ...cutVideo, tracks: cutText(cutVideo.tracks, end), markers, cast, captions };
  // Nothing moved but the end, which is already where it belongs: re-sync only fits transitions and text.
  const synced = resync(cutDoc, {
    moved: [],
    before: timeline,
    ...(options.config ? { config: options.config } : {}),
    ...(options.ids ? { ids: options.ids } : {}),
  });
  // Undo puts cut caption cues back too (core's timeline.restore takes captions).
  const captionsChanged = JSON.stringify(captions) !== JSON.stringify(timeline.captions);
  const changed: TimelinePart[] = [
    'tracks',
    'markers',
    ...(castChanged ? (['cast'] as const) : []),
    ...(captionsChanged ? (['captions'] as const) : []),
  ];
  return ok({ timeline: synced, changed });
}
