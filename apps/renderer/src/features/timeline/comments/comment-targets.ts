// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1-CMT: what a new comment is on. The editor's selection (its chat chip, read back by selection.ts's `chipTarget`:
 * a clip, an item, a stretch of time), or, with nothing selected, the clip under the playhead at that moment, else the
 * whole video. An element on the bed names its item by `data-clip-id`, `data-text-id` or `data-item-id`.
 */
import { editItemsOf, type EditTarget, type SelectionChip, type Timeline } from '@taalcut/core';
import { chipTarget } from '../selection';
import type { CommentOn } from './comment-requests';

/** The clip under `frame`, at that moment; else the whole video. */
export function playheadTarget(timeline: Timeline, frame: number): CommentOn {
  const clip = editItemsOf(timeline).find(
    (place) => place.target.itemKind === 'clip' && place.start <= frame && frame < place.end,
  );
  return clip
    ? { target: clip.target, at: frame - clip.start }
    : { target: { kind: 'timeline', timelineId: timeline.id } };
}

/** What a comment made now is on: the selection (at the playhead, when it is inside it), else the playhead's clip. */
export function newCommentOn(timeline: Timeline, chip: SelectionChip | null, frame: number): CommentOn {
  const target = chip ? chipTarget(chip) : null;
  const selected = target && target.timelineId === timeline.id ? target : null;
  if (!selected) return playheadTarget(timeline, frame);
  if (selected.kind !== 'item') return { target: selected };
  const place = editItemsOf(timeline).find((each) => each.target.itemId === selected.itemId);
  return place && place.start <= frame && frame < place.end
    ? { target: selected, at: frame - place.start }
    : { target: selected };
}

const ITEM_ELEMENTS = '[data-clip-id], [data-text-id], [data-item-id]';

/** The item a bed element stands for, by its data attribute. */
export function elementTarget(element: Element | null, timeline: Timeline): EditTarget | null {
  const owner = element?.closest<HTMLElement>(ITEM_ELEMENTS);
  if (!owner) return null;
  const id = owner.dataset.clipId ?? owner.dataset.textId ?? owner.dataset.itemId;
  const place = editItemsOf(timeline).find((each) => each.target.itemId === id);
  return place?.target ?? null;
}
