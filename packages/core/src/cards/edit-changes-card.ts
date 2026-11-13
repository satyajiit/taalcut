// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1-CTX: the changes card. After an agent turn edited a timeline, it lists each change in plain words with its
 * before and after ("Clip 3: 2.4 s → 1.8 s", "Opening title: 'X' → 'Y'", "Graphic moved to the top"). The agent
 * builds the rows from the timeline before and after the turn (one row per item and kind of change); the renderer
 * words them. Each row names its target, so it can jump to and select it; the card's `group` is the turn's history
 * step (agentTurnGroup), which "Undo all" takes back with `commands.undo({ group })`.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { idSchema } from '../basics/ids';
import { commandGroupSchema } from '../commands/definition';
import { TEXT_ROLES, TRANSITION_KINDS } from '../templates/template-parts';
import { editTargetSchema } from '../timeline/edit-target';
import { base, runId } from './card-parts';

/** At most this many rows; the rest is a count (`more`). */
export const MAX_EDIT_CHANGES = 30;

const seconds = z.number().min(0).max(36_000);
/** Words an item shows, as they were and are: the user's or the agent's text, shown as content. */
const words = z.string().max(500);
/** A speed: a constant one (1 is real time), or a ramp. */
const speed = z.union([z.number().min(0.1).max(16), z.literal('ramp')]);
/**
 * HFW1: a graphic's design, as the card names it: its composition's name (the designing model's words, shown as
 * content) and version.
 */
export const editDesignSchema = z.object({ name: z.string().max(60), version: z.int().min(1) });
export type EditDesign = z.output<typeof editDesignSchema>;

/** Where on the frame an item sits, in words: its box's middle in the top, middle or bottom third. */
export const EDIT_PLACES = ['top', 'middle', 'bottom'] as const;
/** How a clip fills the frame: its fit, or a reframe mode (timeline-items.ts). */
export const EDIT_FRAMINGS = ['cover', 'contain', 'auto', 'subject', 'centre', 'blurPad'] as const;
/** What a whole-video change was about. */
export const EDIT_SETTINGS = ['music', 'captions', 'look', 'voiceover', 'mix'] as const;

export const editChangeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('added') }),
  z.object({ kind: z.literal('removed') }),
  /** Its length on the timeline. */
  z.object({ kind: z.literal('length'), before: seconds, after: seconds }),
  /** When it starts (text, graphics, captions; clips move by `order`). */
  z.object({ kind: z.literal('start'), before: seconds, after: seconds }),
  /** A clip's place among the clips, 1-based. */
  z.object({ kind: z.literal('order'), before: z.int().min(1), after: z.int().min(1) }),
  z.object({ kind: z.literal('words'), before: words, after: words }),
  z.object({ kind: z.literal('place'), before: z.enum(EDIT_PLACES), after: z.enum(EDIT_PLACES) }),
  z.object({ kind: z.literal('speed'), before: speed, after: speed }),
  /** A clip now plays other footage (a swap). */
  z.object({ kind: z.literal('media') }),
  /**
   * FIX-TRIM: a clip plays another part of the same shot in the same place for the same length (a slip): its
   * in-point in seconds of its media, before and after.
   */
  z.object({ kind: z.literal('part'), before: seconds, after: seconds }),
  z.object({ kind: z.literal('framing'), before: z.enum(EDIT_FRAMINGS), after: z.enum(EDIT_FRAMINGS) }),
  z.object({
    kind: z.literal('transition'),
    before: z.enum(TRANSITION_KINDS),
    after: z.enum(TRANSITION_KINDS),
  }),
  /** Gain in dB; null is muted. */
  z.object({
    kind: z.literal('volume'),
    before: z.number().min(-60).max(12).nullable(),
    after: z.number().min(-60).max(12).nullable(),
  }),
  /** A whole-video setting changed (the music, the captions, the look). */
  z.object({ kind: z.literal('setting'), what: z.enum(EDIT_SETTINGS) }),
  /**
   * HFW1: a graphic has a new design: another composition, or a new version of its own. `proposed`: the graphic is
   * still a proposal the person can use.
   */
  z.object({
    kind: z.literal('design'),
    before: editDesignSchema,
    after: editDesignSchema,
    proposed: z.boolean(),
  }),
  /** Something else about it changed (its style, its motion). */
  z.object({ kind: z.literal('other') }),
]);
export type EditChange = z.output<typeof editChangeSchema>;

export const editChangeRowSchema = z.object({
  /** The item (or the whole timeline) the change is to. */
  target: editTargetSchema,
  /** Its number among its kind ("Clip 3"): after the turn, or before it for a removed item; null for the video. */
  number: z.int().min(1).nullable(),
  /** A text item's role, so the card can say "Opening title". */
  role: z.enum(TEXT_ROLES).optional(),
  /** Where to put the playhead when the row is opened: the item's start, after the turn (before, when removed). */
  at: seconds.nullable(),
  change: editChangeSchema,
});
export type EditChangeRow = z.output<typeof editChangeRowSchema>;

export const editChangesCardSchema = z.object({
  type: z.literal('editChanges'),
  ...base,
  runId,
  projectId: idSchema<'Project'>(),
  timelineId: idSchema<'Timeline'>(),
  /** The turn's history step: "Undo all" undoes this group, and only while it is the next undo. */
  group: commandGroupSchema,
  revisionBefore: z.int().min(1),
  revisionAfter: z.int().min(1),
  changes: z.array(editChangeRowSchema).max(MAX_EDIT_CHANGES),
  /** How many changes didn't fit. */
  more: z.int().nonnegative(),
});
export type EditChangesCard = z.output<typeof editChangesCardSchema>;
