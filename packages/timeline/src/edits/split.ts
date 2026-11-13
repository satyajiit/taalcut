// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * timeline.splitClip (EDT1-OPS, SPEC "EDT1-OPS: structure"): one clip becomes two at a frame inside it. The first
 * half keeps the clip's id, slot, cast pick, beat anchor and the transition into it; the second is a new clip with
 * no slot, from the media the first stops at, with the transition out of it and the anchor of its start. A ramp is
 * cut where it is, each half keeping its part of the curve; the sync point stays with the half that shows it. The
 * split lands where asked, or with `snapToBeat` on the grid point nearest it inside the clip; nothing else moves,
 * so nothing re-syncs. Each half lasts at least `minClipFrames`.
 */
import { editItemsOf, err, ok, RationalTime, type Clip, type Result, type Timeline, type TimelineItemId } from '@taalcut/core';
import { InvalidMove } from '../errors';
import { trimEnd, trimStart } from '../model/clip-edit';
import { EDIT_CONFIG } from '../model/config';
import { medianItemFrames, videoItems, withVideoItems } from '../model/sequence';
import { anchorAt, beatGrid, gridPointsNear } from '../resync/grid';
import { clipPosition, type EditOptions, type EditResult } from './types';

export interface SplitInput {
  readonly clipId: TimelineItemId;
  /** Timeline time, strictly inside the clip. */
  readonly at: RationalTime;
  readonly snapToBeat: boolean;
}

/** The clip's two halves at `offset` frames into it: the first keeps its id, the second takes `id`. */
export function splitHalves(
  timeline: Timeline,
  clip: Clip,
  start: number,
  offset: number,
  id: TimelineItemId,
): readonly [Clip, Clip] {
  const rate = timeline.canvas.rate;
  const length = clip.duration.value;
  const first = trimEnd(clip, offset - length, rate);
  const rest = trimStart(clip, offset, rate);
  // The sync point is in the half whose media shows it.
  const inSecond =
    clip.syncPoint !== null && clip.media.kind !== 'image' && RationalTime.compare(clip.syncPoint, rest.sourceStart) >= 0;
  const grid = beatGrid(timeline.beatMap, rate, medianItemFrames(videoItems(timeline)));
  const second: Clip = {
    ...rest,
    id,
    slotId: null,
    syncPoint: inSecond ? clip.syncPoint : null,
    beatAnchor: anchorAt(grid, start + offset, rate),
  };
  return [{ ...first, syncPoint: inSecond ? null : clip.syncPoint }, second];
}

/** The frame to split at: `at` on the canvas, or the grid point nearest it that leaves both halves long enough. */
function splitFrame(timeline: Timeline, input: SplitInput, start: number, end: number, min: number): number | null {
  const rate = timeline.canvas.rate;
  const asked = RationalTime.rescale(input.at, rate, 'round').value;
  const inside = (frame: number) => frame - start >= min && end - frame >= min;
  // EDT1-OPS: a time the split refuses without snapToBeat is refused with it, never snapped to a beat inside: outside
  // the clip (eval run 11, "clip 5 at 0 s"), or at or near its edge (run 14, "clip 5 at 7 s", where clip 5 starts).
  // Either way the 9B had split the waves a second time, where nobody asked.
  if (!inside(asked)) return null;
  if (!input.snapToBeat) return asked;
  const grid = beatGrid(timeline.beatMap, rate, medianItemFrames(videoItems(timeline)));
  return gridPointsNear(grid, asked, start + min, end - min).find(inside) ?? null;
}

export function splitClip(
  timeline: Timeline,
  input: SplitInput,
  options: EditOptions & { readonly ids: () => TimelineItemId },
): Result<EditResult & { readonly itemId: TimelineItemId }> {
  const found = clipPosition(timeline, input.clipId, options.source);
  if (!found.ok) return found;
  const { item: clip, itemIndex, start, end } = found.value;
  const min = (options.config ?? EDIT_CONFIG).minClipFrames;
  const frame = splitFrame(timeline, input, start, end, min);
  if (frame === null) {
    // EDT1-OPS: say where the clip is, in the seconds the editor tools take: a model read "at" as from the clip's own start.
    const rate = timeline.canvas.rate;
    const secs = (frames: number) => Math.round(((frames * rate.den) / rate.num) * 100) / 100;
    // The clip by its number, as the editor and the tools number it (core's editItemsOf).
    const number = editItemsOf(timeline).find((place) => place.target.itemId === clip.id)?.number;
    const which = number === undefined ? 'It plays' : `Clip ${number} plays`;
    return err(
      InvalidMove(undefined, {
        detail:
          `The split is under ${min} frames from an end of the clip. ${which} from ${secs(start)} s to ${secs(end)} s ` +
          `of the video (its middle is ${secs((start + end) / 2)} s): split at a time between them.`,
      }),
    );
  }
  const id = options.ids();
  const halves = splitHalves(timeline, clip, start, frame - start, id);
  const items = [...videoItems(timeline)];
  items.splice(itemIndex, 1, ...halves);
  return ok({ timeline: withVideoItems(timeline, items), changed: ['tracks'], itemId: id });
}
