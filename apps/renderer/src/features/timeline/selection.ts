// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What is selected in the editor: one clip, one text item, one other item on the bed (a graphic, a caption, a
 * piece of audio, a transition: EDT1), or a stretch of time (dragged on the ruler). Each can be pointed at in the
 * chat (core's SelectionChip) and is what "this" means in the docked chat (core's EditTarget). A text item is
 * also edited in place.
 */
import {
  TimeRange,
  type EditItemKind,
  type EditItemTarget,
  type EditTarget,
  type FrameRate,
  type SelectionChip,
  type TimelineId,
  type TimelineItemId,
} from '@taalcut/core';
import { atRate, toFrames } from './model';

/** The kinds a plain `item` selection holds: clips and text have their own (they have their own tools). */
export type OtherItemKind = Exclude<EditItemKind, 'clip' | 'text'>;

export type EditorSelection =
  | { readonly kind: 'clip'; readonly clipId: TimelineItemId }
  | { readonly kind: 'text'; readonly itemId: TimelineItemId }
  | { readonly kind: 'item'; readonly itemId: EditItemTarget['itemId']; readonly itemKind: OtherItemKind }
  | { readonly kind: 'range'; readonly start: number; readonly end: number }
  | null;

/** The selection as an edit target on `timelineId` (what the docked chat sends); null for nothing. */
export function toTarget(
  selection: EditorSelection,
  timelineId: TimelineId | undefined,
  rate: FrameRate | undefined,
): EditTarget | null {
  if (!selection || !timelineId || !rate) return null;
  switch (selection.kind) {
    case 'clip':
      return { kind: 'item', timelineId, itemId: selection.clipId, itemKind: 'clip' };
    case 'text':
      return { kind: 'item', timelineId, itemId: selection.itemId, itemKind: 'text' };
    case 'item':
      return { kind: 'item', timelineId, itemId: selection.itemId, itemKind: selection.itemKind };
    case 'range':
      return {
        kind: 'range',
        timelineId,
        range: TimeRange.of(atRate(selection.start, rate), atRate(selection.end - selection.start, rate)),
      };
  }
}

/** The chip "Add to chat" puts in the composer: a clip keeps the clip chip; any other item is an item chip. */
export function toChip(
  selection: EditorSelection,
  timelineId: TimelineId | undefined,
  rate: FrameRate | undefined,
): SelectionChip | null {
  if (selection?.kind === 'clip' && timelineId) return { kind: 'clip', timelineId, clipId: selection.clipId };
  return toTarget(selection, timelineId, rate) as SelectionChip | null;
}

/**
 * An edit target as the editor's selection (`select(target)` from a card, a comment, the gfx or ops lanes'
 * panels); null for the whole timeline, which is nothing selected.
 */
export function fromTarget(target: EditTarget | null, rate: FrameRate): EditorSelection {
  if (!target) return null;
  switch (target.kind) {
    case 'timeline':
      return null;
    case 'range': {
      const start = toFrames(target.range.start, rate);
      return { kind: 'range', start, end: start + toFrames(target.range.duration, rate) };
    }
    case 'item':
      if (target.itemKind === 'clip') return { kind: 'clip', clipId: target.itemId as TimelineItemId };
      if (target.itemKind === 'text') return { kind: 'text', itemId: target.itemId as TimelineItemId };
      return { kind: 'item', itemId: target.itemId, itemKind: target.itemKind };
  }
}

/** The id of the selected item, whatever its kind; null for a range or nothing. */
export function selectedItemId(selection: EditorSelection): string | null {
  if (!selection || selection.kind === 'range') return null;
  return selection.kind === 'clip' ? selection.clipId : selection.itemId;
}

/** What a chip points at on a timeline, as an edit target; null for a template's slot or an effect. */
export function chipTarget(chip: SelectionChip): EditTarget | null {
  switch (chip.kind) {
    case 'clip':
      return { kind: 'item', timelineId: chip.timelineId, itemId: chip.clipId, itemKind: 'clip' };
    case 'item':
    case 'range':
      return chip;
    default:
      return null;
  }
}
