// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1: what an edit is about, and what the editor shows when the user writes in its docked chat.
 *
 * An edit target is one thing on a timeline (a clip, a line of text, a graphic, a caption, a piece of audio, a
 * transition), a stretch of its time, or the whole timeline. Chips, comments (EDT1-CMT's anchor) and the agent's
 * changes all name their subject with one. The editor context is the open timeline as the user sees it: its
 * revision, the playhead, what is selected and the part of the bed in view. The docked composer sends it with
 * every message, so "this", "here" and "the next clip" resolve against what was on screen.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { idSchema, ulidSchema } from '../basics/ids';
import { RationalTime, rationalTimeJsonSchema, rationalTimeSchema } from '../time/rational-time';
import { timeRangeSchema } from '../time/time-range';

/**
 * The kinds of thing on a timeline a person can point at. `clip` is a video or still on a video track, `text` a
 * text item, `graphic` a motion graphic, `caption` one caption cue, `audio` a clip on an audio track (music,
 * voice or a sound), `transition` a transition item between two clips.
 */
export const EDIT_ITEM_KINDS = ['clip', 'text', 'graphic', 'caption', 'audio', 'transition'] as const;
export type EditItemKind = (typeof EDIT_ITEM_KINDS)[number];

/** An item's id: a timeline item's, or a caption cue's (captions keep their own ids). */
export const editItemIdSchema = idSchema<'TimelineItem' | 'CaptionCue'>();

/** One item on a timeline. Also a selection chip's shape (chat-start.ts). */
export const editItemTargetSchema = z.object({
  kind: z.literal('item'),
  timelineId: idSchema<'Timeline'>(),
  itemId: editItemIdSchema,
  itemKind: z.enum(EDIT_ITEM_KINDS),
});
export type EditItemTarget = z.output<typeof editItemTargetSchema>;

/** A stretch of a timeline, at its canvas rate. */
export const editRangeTargetSchema = z.object({
  kind: z.literal('range'),
  timelineId: idSchema<'Timeline'>(),
  range: timeRangeSchema,
});
export type EditRangeTarget = z.output<typeof editRangeTargetSchema>;

/** The whole timeline: what "the video" means. */
export const editTimelineTargetSchema = z.object({
  kind: z.literal('timeline'),
  timelineId: idSchema<'Timeline'>(),
});
export type EditTimelineTarget = z.output<typeof editTimelineTargetSchema>;

export const editTargetSchema = z.discriminatedUnion('kind', [
  editItemTargetSchema,
  editRangeTargetSchema,
  editTimelineTargetSchema,
]);
export type EditTarget = z.output<typeof editTargetSchema>;

/**
 * An edit target as a model writes it, for tool and skill schemas: plain strings and numbers that convert to JSON
 * Schema (`idSchema` is a custom check and a rate transforms, which JSON Schema can't carry). Its output has an
 * `EditTarget`'s shape (checked at compile time in the tests); a tool checks what the model wrote with
 * `parseEditTarget` before it uses it, as the bus checks a payload again on dispatch.
 */
export const editTargetJsonSchema = z
  .discriminatedUnion('kind', [
    z.object({
      kind: z.literal('item'),
      timelineId: ulidSchema('Timeline'),
      itemId: ulidSchema<'TimelineItem' | 'CaptionCue'>('TimelineItem').describe(
        "The item's id (a caption's is its cue's)",
      ),
      // A model often leaves the kind out (the 9B did, again and again): the id names the item, and
      // `resolveEditTarget` reads its kind from the timeline.
      itemKind: z
        .enum(EDIT_ITEM_KINDS)
        .optional()
        .describe("The item's kind; may be left out, it is read from the timeline"),
    }),
    z.object({
      kind: z.literal('range'),
      timelineId: ulidSchema('Timeline'),
      range: z
        .object({ start: rationalTimeJsonSchema, duration: rationalTimeJsonSchema })
        .describe('A stretch of the timeline, at its canvas rate'),
    }),
    z.object({ kind: z.literal('timeline'), timelineId: ulidSchema('Timeline') }),
    // A model also writes an item with its kind as `kind` ({ kind: 'clip', itemId }): taken as an item target, its
    // kind read from the timeline again (`resolveEditTarget`).
    z.object({
      kind: z.enum(EDIT_ITEM_KINDS),
      timelineId: ulidSchema('Timeline'),
      itemId: ulidSchema<'TimelineItem' | 'CaptionCue'>('TimelineItem').describe(
        "The item's id (a caption's is its cue's)",
      ),
    }),
  ])
  .describe('One item on a timeline, a stretch of its time, or the whole timeline');
export type EditTargetJson = z.output<typeof editTargetJsonSchema>;

/**
 * A target a model wrote, checked as an `EditTarget` (real ids, a valid rate, no negative length); null if not. An
 * item target needs its `itemKind` here: a tool that has the timeline uses `resolveEditTarget` (edit-items.ts), which
 * reads it from there.
 */
export function parseEditTarget(value: unknown): EditTarget | null {
  const parsed = editTargetSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** The most the editor sends as its selection: the chips' own limit (MAX_SELECTIONS). */
export const MAX_EDITOR_SELECTION = 20;

/**
 * The editor as the user saw it when they sent a docked message. Times are at the timeline's canvas rate.
 * `revision` is the timeline's revision on screen: the agent reads the timeline again before it edits, and a
 * newer revision means the selection may name items that moved or went.
 */
export const editorContextSchema = z.object({
  timelineId: idSchema<'Timeline'>(),
  revision: z.int().min(1),
  playhead: rationalTimeSchema.refine((time) => time.value >= 0, { message: 'Before zero' }),
  /** What is selected, first selected first. Empty when nothing is. */
  selection: z.array(editTargetSchema).max(MAX_EDITOR_SELECTION),
  /** The part of the bed in view, when the editor knows it. */
  visibleRange: timeRangeSchema.optional(),
});
export type EditorContext = z.output<typeof editorContextSchema>;

/** True when two targets name the same thing (a range by its exact start and length). */
export function sameEditTarget(a: EditTarget, b: EditTarget): boolean {
  if (a.timelineId !== b.timelineId || a.kind !== b.kind) return false;
  if (a.kind === 'item' && b.kind === 'item') return a.itemId === b.itemId;
  if (a.kind === 'range' && b.kind === 'range')
    return (
      RationalTime.equals(a.range.start, b.range.start) &&
      RationalTime.equals(a.range.duration, b.range.duration)
    );
  return true;
}
