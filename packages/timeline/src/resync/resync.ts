// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Beat re-sync (R14, SPEC "Re-sync"), run inside every edit after the change:
 * moved cuts go to the nearest grid point that fits, clips whose start moved
 * take the anchor of their new start, and transitions and text follow. Cuts
 * the edit didn't touch stay put, and re-syncing a synced timeline changes
 * nothing.
 */
import {
  newId,
  RationalTime,
  type BeatMap,
  type Clip,
  type FrameRate,
  type Marker,
  type SequenceItem,
  type Timeline,
  type TimelineItemId,
} from '@taalcut/core';
import { trimEnd, trimStart, toMedia } from '../model/clip-edit';
import { EDIT_CONFIG, type EditConfig } from '../model/config';
import { isMarkerAt, marker, MARKER_LABELS } from '../model/markers';
import { medianItemFrames, positions, videoItems, withVideoItems, type Filler } from '../model/sequence';
import { clipMediaFits, sourceFrames } from '../model/speed';
import { anchorAt, anchorFrame, beatGrid, gridPointsNear, type BeatGrid } from './grid';
import { fitTransitions, followText } from './neighbours';

export interface ResyncOptions {
  /** Positions whose start cut the edit moved (roll or ripple); `positions.length` is the video's end. */
  readonly moved?: readonly number[];
  /** Positions whose clip takes the anchor of its start although no cut moved (a new grid). */
  readonly reanchor?: readonly number[];
  /** The timeline before the edit, so text keeps its offset into a clip that moved. Default: the input. */
  readonly before?: Timeline;
  readonly config?: EditConfig;
  /** Ids for the markers re-sync adds. Default: new ULIDs. */
  readonly ids?: () => TimelineItemId;
}

interface Context {
  readonly rate: FrameRate;
  readonly grid: BeatGrid;
  readonly config: EditConfig;
}

/** A cut may make a neighbour shorter only while it stays at least minClip long. */
function longEnough(item: Filler, before: Filler, config: EditConfig): boolean {
  if (item.duration.value < 1) return false;
  return item.duration.value >= config.minClipFrames || item.duration.value >= before.duration.value;
}

function fits(item: Filler, rate: FrameRate): boolean {
  return item.type === 'gap' || (item.type === 'clip' && clipMediaFits(item, rate));
}

/** Moves the cut at the start of position `cut` (or the end) by `shift`; null when a neighbour can't take it. */
function shiftCut(
  items: readonly SequenceItem[],
  cut: number,
  shift: number,
  context: Context,
): SequenceItem[] | null {
  const all = positions(items);
  const left = all[cut - 1];
  const right = all[cut];
  if (!left) return null;
  const out = [...items];
  const newLeft = trimEnd(left.item, shift, context.rate);
  if (!longEnough(newLeft, left.item, context.config) || !fits(newLeft, context.rate)) return null;
  out[left.itemIndex] = newLeft;
  if (right) {
    const newRight = trimStart(right.item, shift, context.rate);
    if (!longEnough(newRight, right.item, context.config) || !fits(newRight, context.rate)) return null;
    out[right.itemIndex] = newRight;
  }
  return out;
}

/** Snaps one moved cut; reports whether it landed on the grid. */
function snapCut(items: SequenceItem[], cut: number, context: Context): { items: SequenceItem[]; on: boolean } {
  const all = positions(items);
  const current = all[cut]?.start ?? all.at(-1)?.end ?? 0;
  const reach = (context.grid.interval ?? 0) * context.config.searchBeats;
  for (const point of gridPointsNear(context.grid, current, current - reach, current + reach)) {
    if (point === current) return { items, on: true };
    const shifted = shiftCut(items, cut, point - current, context);
    if (shifted) return { items: shifted, on: true };
  }
  return { items, on: false };
}

/** A clip whose start moved takes its new start's anchor and, when the media allows, puts its peak on it. */
function followAnchor(clip: Clip, start: number, context: Context): Clip {
  const anchor = anchorAt(context.grid, start, context.rate);
  const anchored: Clip = { ...clip, beatAnchor: anchor };
  if (!anchor || !clip.syncPoint || clip.media.kind === 'image') return anchored;
  const landed = anchorFrame(context.grid, anchor) ?? start;
  const lead = toMedia(Math.round(sourceFrames(clip.speed, landed - start)), context.rate, clip.syncPoint.rate);
  const placed: Clip = { ...anchored, sourceStart: RationalTime.subtract(clip.syncPoint, lead) };
  return clipMediaFits(placed, context.rate) ? placed : anchored;
}

function grid(timeline: Timeline): BeatGrid {
  return beatGrid(timeline.beatMap, timeline.canvas.rate, medianItemFrames(videoItems(timeline)));
}

export function resync(timeline: Timeline, options: ResyncOptions = {}): Timeline {
  const config = options.config ?? EDIT_CONFIG;
  const ids = options.ids ?? (() => newId<'TimelineItem'>());
  const rate = timeline.canvas.rate;
  const context: Context = { rate, grid: grid(timeline), config };
  let items = [...videoItems(timeline)];
  // The timeline's first frame is never a cut that can move.
  const moved = [...new Set(options.moved ?? [])].filter((cut) => cut > 0).sort((a, b) => a - b);
  const startFrames = (cut: number) => positions(items)[cut]?.start ?? positions(items).at(-1)?.end ?? 0;

  let markers: Marker[] = [...timeline.markers];
  for (const cut of moved) {
    const from = startFrames(cut);
    const snapped = snapCut(items, cut, context);
    items = snapped.items;
    const to = startFrames(cut);
    markers = markers.filter(
      (item) => !isMarkerAt(item, MARKER_LABELS.offBeat, from) && !isMarkerAt(item, MARKER_LABELS.offBeat, to),
    );
    if (!snapped.on) markers.push(marker(ids(), 'qa', MARKER_LABELS.offBeat, to, 1, rate));
  }

  const all = positions(items);
  for (const cut of new Set([...moved, ...(options.reanchor ?? [])])) {
    const position = all[cut];
    if (position?.item.type === 'clip')
      items[position.itemIndex] = followAnchor(position.item, position.start, context);
  }
  items = fitTransitions(items, rate);

  const edited = withVideoItems({ ...timeline, markers }, items);
  const tracks = followText(options.before ?? timeline, edited);
  return { ...edited, tracks };
}

/**
 * Re-times the timeline to another grid, e.g. the user's own track (P2-M10): every cut, the end included,
 * is free to move to the new grid, and every clip takes the anchor of its start.
 */
export function resyncToBeatMap(
  timeline: Timeline,
  beatMap: BeatMap | null,
  options: Omit<ResyncOptions, 'moved' | 'before'> = {},
): Timeline {
  const retimed = { ...timeline, beatMap };
  const count = positions(videoItems(retimed)).length;
  const every = Array.from({ length: count + 1 }, (_, index) => index);
  return resync(retimed, { ...options, moved: every, reanchor: every, before: timeline });
}

/**
 * A track's beat map placed under the timeline: `offset` is the track time under frame 0 (music.choosePath's own
 * track), so a beat at track time t falls at t − offset. Beats before frame 0 go; downbeats keep their beats.
 */
export function beatsUnderTimeline(beatMap: BeatMap, offset: RationalTime): BeatMap {
  const shift = RationalTime.rescale(offset, beatMap.rate, 'round').value;
  const beats = beatMap.beats.map((beat) => RationalTime.rescale(beat, beatMap.rate, 'round').value - shift);
  const dropped = beats.filter((value) => value < 0).length;
  return {
    ...beatMap,
    beats: beats.slice(dropped).map((value) => RationalTime.of(value, beatMap.rate)),
    downbeats: beatMap.downbeats.filter((index) => index >= dropped).map((index) => index - dropped),
  };
}
