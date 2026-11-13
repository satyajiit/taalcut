// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Comments follow their anchors (EDT1-CMT). An item's comment points at it by id, and its moment (`at`) counts from
 * the item's start, so a move needs nothing. When a timeline changes from `before` to `after`:
 *
 * - a moment now past its item's end went with a split to the new part that holds it (same kind, same track, same
 *   media or words); with no such part (a trim) it stays at the item's last frame;
 * - an item that is gone hands its comments to its heir: a new item, or one that grew, of the same kind and content
 *   on the same track, covering the comment's moment (a split that renumbered both halves, an undone split);
 * - otherwise the comment becomes a range at the item's last time, its moment kept.
 *
 * Ranges and whole-video comments stay where they are. Pure: the store's timeline writes call it.
 */
import {
  editItemMap,
  RationalTime,
  TimeRange,
  type EditItemMap,
  type EditItemPlace,
  type EditTarget,
  type Timeline,
  type TimelineComment,
} from '@taalcut/core';

type Items = EditItemMap;
type PointableItem = EditItemPlace;
const kindOf = (item: PointableItem) => item.target.itemKind;
const idOf = (item: PointableItem): string => item.target.itemId;

/** What an item shows, so a split's halves match each other and nothing else does. */
function contentKeys(timeline: Timeline): Map<string, string> {
  const keys = new Map<string, string>();
  for (const track of timeline.tracks)
    for (const item of track.items) {
      if (item.type === 'clip')
        keys.set(item.id, `${item.media.assetId}:${'shotId' in item.media ? item.media.shotId : ''}`);
      else if (item.type === 'text') keys.set(item.id, `text:${item.text}`);
      else if (item.type === 'graphic') keys.set(item.id, `graphic:${item.composition.id}`);
      else if (item.type === 'transition') keys.set(item.id, `transition:${item.kind}`);
    }
  for (const cue of timeline.captions?.cues ?? []) keys.set(cue.id, 'caption');
  return keys;
}

const covers = (item: PointableItem, frame: number) => frame >= item.start && frame < item.end;

export interface TimelineChange {
  readonly before: Timeline;
  readonly after: Timeline;
}

/** The comments of `change.after`'s timeline that move, with their new anchor and moment. */
export function followComments(
  comments: readonly TimelineComment[],
  change: TimelineChange,
  now: number,
): TimelineComment[] {
  const { before, after } = change;
  const rate = after.canvas.rate;
  const was: Items = editItemMap(before);
  const is: Items = editItemMap(after);
  const wasKeys = contentKeys(before);
  const isKeys = contentKeys(after);
  const time = (frames: number) => RationalTime.of(Math.max(0, Math.round(frames)), rate);

  /** A new item, or one that grew, holding `frame` and showing what `old` showed. */
  function heir(old: PointableItem, frame: number): PointableItem | undefined {
    for (const item of is.values()) {
      if (kindOf(item) !== kindOf(old) || item.trackId !== old.trackId || !covers(item, frame)) continue;
      if (isKeys.get(idOf(item)) !== wasKeys.get(idOf(old))) continue;
      const earlier = was.get(idOf(item));
      if (!earlier || item.end - item.start > earlier.end - earlier.start) return item;
    }
    return undefined;
  }

  const moved = (comment: TimelineComment, anchor: EditTarget, at: number | null): TimelineComment => {
    const { at: _old, ...rest } = comment;
    return { ...rest, anchor, ...(at !== null ? { at: time(at) } : {}), updatedAt: now };
  };
  const onto = (comment: TimelineComment, item: PointableItem, at: number | null) =>
    moved(comment, item.target, at);

  const out: TimelineComment[] = [];
  for (const comment of comments) {
    const { anchor } = comment;
    if (anchor.kind !== 'item' || comment.timelineId !== after.id) continue;
    const offset = comment.at ? RationalTime.toFrames(comment.at, rate) : null;
    const old = was.get(anchor.itemId);
    const current = is.get(anchor.itemId);
    if (current) {
      const length = current.end - current.start;
      if (offset === null || offset < length) continue;
      // Its moment is past the item's end now: a split took it to the new part, or a trim cut it off.
      const frame = (old ?? current).start + offset;
      const part = old ? heir(old, frame) : undefined;
      if (part && idOf(part) !== idOf(current)) out.push(onto(comment, part, frame - part.start));
      else out.push(moved(comment, anchor, Math.max(0, length - 1)));
      continue;
    }
    // Gone: we can only follow what we saw.
    if (!old) continue;
    const frame = old.start + (offset ?? 0);
    const next = heir(old, frame);
    if (next) {
      out.push(onto(comment, next, offset === null ? null : frame - next.start));
      continue;
    }
    const range = TimeRange.of(time(Math.max(0, old.start)), time(old.end - Math.max(0, old.start)));
    out.push(moved(comment, { kind: 'range', timelineId: after.id, range } as EditTarget, offset));
  }
  return out;
}
