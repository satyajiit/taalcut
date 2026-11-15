// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * TXT1: a made video's on-screen text is designed and placed by whoever makes the video, never by code. The owner's
 * videos drew every word in the default face (no timeline had a Style, so no look applied), and the words sat "one
 * small, one large, one at top, one centre": each was solved on its own.
 *
 * - **The look** is data the AI states, one for each text role the video uses (a text item's `styleKey`): a face
 *   of the bundled set, its weight, colour, outline, shadow, box and letter spacing (a Style's `textStyles`), and
 *   for the role's texts their letter case and how they arrive. `timeline.designText` saves it as a Style of the
 *   video's own and points the video at it; render draws it. Nothing here chooses a look: a role without one is
 *   named by `undesignedTextRoles`.
 * - **The place and the size** are stated too, for each group of texts (texts the reel showed in turn at one place
 *   are one group, any other text is its own): `timeline.placeText`. What is stated is applied as it is; no code
 *   moves, clamps, raises or refuses a place or a size. The lines are stated as well: a text draws on one line
 *   unless a break is stated (a line break in its words, or the place's `width`), so no size wraps a sentence.
 *   The reading size (`READABLE_CAP_PX`) is a fact the tools report beside a text's own size, nothing more. A
 *   text made from the reference that nobody has placed yet is named by `unplacedTexts`; one a person or the AI
 *   placed carries `placedBy` and nothing automatic moves it.
 * - The make's last gate (`video.done`) holds the hand-off until every role has a look and every text a stated
 *   place. It never judges a look, a place or a size.
 *
 * The commands' handlers are @taalcut/timeline's.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { ulidSchema } from '../basics/ids';
import { MAX_TEXT_STYLES, textLookSchema, type Style } from '../styles/style-schema';
import { styleKeySchema, TEXT_REVEALS, textAppearanceSchema } from '../templates/template-parts';
import type { Timeline } from './timeline-schema';

/**
 * The reading fact: capitals under 36 px at 1080 on the shorter side are hard to read on a phone (QA's own
 * measure). A fact the tools report; nothing holds a text to it.
 */
export const READABLE_CAP_PX = 36;

/** The text size (`appearance.size`: cap height over canvas height) that is `READABLE_CAP_PX` on `canvas`. */
export function readableTextSize(canvas: { readonly width: number; readonly height: number }): number {
  return (READABLE_CAP_PX * Math.min(canvas.width, canvas.height)) / 1080 / canvas.height;
}

/** The look of one text role, with what it sets on the role's texts themselves. */
export const textRoleLookSchema = z.object({
  /** The role it dresses: a text item's `styleKey` ('title', 'label', 'caption', …). */
  role: styleKeySchema,
  look: textLookSchema,
  /** The letter case of every text of the role; absent keeps each text's own. */
  case: textAppearanceSchema.shape.case.optional(),
  /** How every text of the role arrives; absent keeps each text's own. */
  reveal: z.enum(TEXT_REVEALS).optional(),
});
export type TextRoleLook = z.output<typeof textRoleLookSchema>;

/**
 * `timeline.designText` (handler: @taalcut/timeline): the video's text looks, saved as a new Style that keeps the
 * rest of the Style the video had (colours, fonts, captions, logo, intro, outro, grade), and the video pointed at
 * it. Every role the video's text uses must be given. One undo step (the video's Style and tracks as they were;
 * the Style it made stays in the library).
 */
export const TEXT_DESIGN_COMMAND = 'timeline.designText';
export const designTextPayloadSchema = z.object({
  projectId: ulidSchema('Project'),
  timelineId: ulidSchema('Timeline'),
  revision: z.int().positive().optional(),
  /**
   * The id of the Style it makes; the handler makes one when absent. A caller that gives it makes the command safe
   * to run again (a redo finds the Style it made the first time and makes no second one).
   */
  styleId: ulidSchema('Style').optional(),
  /** The Style's name: the look named by whoever designed it, in the person's language. */
  name: z.string().trim().min(1).max(80),
  looks: z.array(textRoleLookSchema).min(1).max(MAX_TEXT_STYLES),
});
export type DesignTextPayload = z.output<typeof designTextPayloadSchema>;

export const designTextResultSchema = z.object({
  timelineId: ulidSchema('Timeline'),
  revision: z.int().positive(),
  affectedItemIds: z.array(z.string()),
  styleId: ulidSchema('Style'),
  /** The roles that now have a look. */
  roles: z.array(styleKeySchema),
});
export type DesignTextResult = z.output<typeof designTextResultSchema>;

/** The most groups one `timeline.placeText` states. */
export const MAX_TEXT_PLACES = 60;

/**
 * Where one group of texts sits and how large it is, as stated. `itemId` is any text of the group: texts the reel
 * showed in turn at one place move as one, each set in the group's box the way `align` says. `asReel` states the
 * reel's own place and size for the group. Otherwise `x` and `y` are where the group's anchor sits, as shares of
 * the frame: `x` its left edge, centre or right edge as `align` names, `y` its middle; `size` is the capitals'
 * height as a share of the frame's height. A part left out stays as it is.
 *
 * The lines are stated too. A group placed here draws each of its texts on one line (a line break in a text's words
 * is the only break), however large it is stated: no size wraps a sentence. `width` states a wrap: the widest a
 * line may be, as a share of the frame's width. It does not stay: a later place without it is one line again.
 */
export const textPlaceSchema = z.object({
  itemId: ulidSchema('TimelineItem'),
  asReel: z.boolean().optional(),
  x: z.number().min(0).max(1).optional(),
  y: z.number().min(0).max(1).optional(),
  align: textAppearanceSchema.shape.align.optional(),
  size: textAppearanceSchema.shape.size.optional(),
  width: z.number().min(0.05).max(1).optional(),
});
export type TextPlace = z.output<typeof textPlaceSchema>;

/**
 * `timeline.placeText` (handler: @taalcut/timeline): each group where it was stated, at the size stated, exactly.
 * Nothing is moved into a safe area, raised to a readable size or refused for where or how large it is. Every
 * text it places records who placed it (`placedBy`); a text a person placed stays where the person put it. One
 * undo step.
 */
export const TEXT_PLACE_COMMAND = 'timeline.placeText';
export const placeTextPayloadSchema = z.object({
  projectId: ulidSchema('Project'),
  timelineId: ulidSchema('Timeline'),
  revision: z.int().positive().optional(),
  groups: z.array(textPlaceSchema).min(1).max(MAX_TEXT_PLACES),
});
export type PlaceTextPayload = z.output<typeof placeTextPayloadSchema>;

export const placeTextResultSchema = z.object({
  timelineId: ulidSchema('Timeline'),
  revision: z.int().positive(),
  affectedItemIds: z.array(z.string()),
  /** The texts that now carry a stated place. */
  placed: z.int().min(0),
});
export type PlaceTextResult = z.output<typeof placeTextResultSchema>;

/** One text role of a video: how many texts carry it, and which. */
export interface TextRoleUse {
  readonly role: string;
  readonly itemIds: readonly string[];
}

/** The text roles a video draws: the `styleKey` of every text item on an enabled text track, in first-seen order. */
export function textRolesOf(timeline: Pick<Timeline, 'tracks'>): TextRoleUse[] {
  const byRole = new Map<string, string[]>();
  for (const track of timeline.tracks) {
    if (track.kind !== 'text' || !track.enabled) continue;
    for (const item of track.items) {
      if (item.type !== 'text') continue;
      byRole.set(item.styleKey, [...(byRole.get(item.styleKey) ?? []), item.id]);
    }
  }
  return [...byRole.entries()].map(([role, itemIds]) => ({ role, itemIds }));
}

/**
 * The roles whose texts would be drawn in the default face: no look for them in the Style the video renders with
 * (`style`: the resolved one, or null for none). Empty when every text is designed, or the video has no text.
 */
export function undesignedTextRoles(
  timeline: Pick<Timeline, 'tracks'>,
  style: Pick<Style, 'textStyles'> | null,
): TextRoleUse[] {
  return textRolesOf(timeline).filter((use) => style?.textStyles[use.role] === undefined);
}

/**
 * The texts made from the reference that nobody has placed yet (no `placedBy`): they sit where the reel had them.
 * A text added by hand or by a tool was placed when it was made, and is never one of them.
 */
export function unplacedTexts(timeline: Pick<Timeline, 'tracks'>): string[] {
  const ids: string[] = [];
  for (const track of timeline.tracks) {
    if (track.kind !== 'text' || !track.enabled) continue;
    for (const item of track.items)
      if (item.type === 'text' && item.overlayId !== null && item.placedBy === undefined) ids.push(item.id);
  }
  return ids;
}
