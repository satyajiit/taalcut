// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * DSG1-READ: a reel's graphics read the way a motion designer would. For each overlay the breakdown kept, a vision
 * model (the chat's model when it can see images, the on-device model when local-only) reads pictures of it over its
 * life with the measured facts (OCR, the pixel design, timing, beats, speech, the reel's people) and writes a brief:
 * what it is, its part in the story, its look in a designer's words, its motion, its timing and its relation to
 * people. It also says when a reading isn't a graphic at all (a sign, a shop front, a screen: footage), with its
 * reason; made videos leave such an overlay out, and the review shows it as removed and restorable.
 *
 * The brief is the one aut designs a component from (graphic-components.ts keeps a snapshot of it in a component's
 * provenance). The reading lives in `Template.graphics.reading`, beside aut's components, with the graphic system
 * the briefs share: the measured tokens, the conversation's order and sides, and how messages stack. The measured
 * design stays on each overlay (`design`, BRK1-GFX); a brief's words sit beside those facts and never replace them.
 * Everything a model wrote is untrusted text, shown as plain text only.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { idSchema } from '../basics/ids';
import { hexColorSchema, overlayFontSchema } from './template-parts';

/**
 * What a graphic is, a brief's `kind`. A message is `incomingMessage` (someone else's) or `outgoingMessage` (the
 * creator's own).
 */
export const GRAPHIC_BRIEF_KINDS = [
  'incomingMessage',
  'outgoingMessage',
  'typingIndicator',
  'title',
  'caption',
  'locationTag',
  'lowerThird',
  'pill',
  'label',
  'sticker',
  'callout',
  'callToAction',
  'other',
] as const;
/** A graphic's part in the story: a question and its answer, a setup and its payoff, and so on. */
export const GRAPHIC_STORY_ROLES = [
  'question',
  'answer',
  'setup',
  'payoff',
  'hook',
  'context',
  'reaction',
  'callToAction',
  'other',
] as const;
/** The platform a graphic's look recalls: an iMessage- or WhatsApp-like thread, an Instagram sticker, or none. */
export const GRAPHIC_PLATFORMS = ['imessage', 'whatsapp', 'instagram', 'neutral'] as const;
/** What a graphic's entrance is timed to: a beat, a line of speech, a cut, or none of them. */
export const GRAPHIC_TIMING_CUES = ['beat', 'speech', 'cut', 'free'] as const;
/** Who wrote a brief last: a vision model, the measured facts alone (no model answered), or the person. */
export const GRAPHIC_BRIEF_SOURCES = ['model', 'facts', 'person'] as const;
/** Who sends a message in the reel's conversation: the creator, or someone else. */
export const CONVERSATION_SPEAKERS = ['me', 'them'] as const;
export const CONVERSATION_SIDES = ['left', 'right'] as const;
export const GRAPHIC_STACKS = ['down', 'up'] as const;

/** The prompt a reading came from, so a later prompt's briefs can be told apart (`graphic-brief/<n>`). */
export const GRAPHIC_BRIEF_PROMPT_PATTERN = /^[a-z][a-z0-9-]{0,40}\/[0-9]{1,4}$/;
export const GRAPHIC_WORDS_MAX = 300;

const unit = z.number().min(0).max(1);
/** Plain words, one paragraph at most. Model output: untrusted, shown as plain text only. */
const words = (max: number) => z.string().trim().max(max);
const overlayId = idSchema<'TextOverlay'>();

export const graphicLookSchema = z.object({
  /** The look in a designer's words: "a white rounded bubble with a tail at the bottom right, like iMessage". */
  words: words(GRAPHIC_WORDS_MAX),
  platform: z.enum(GRAPHIC_PLATFORMS),
  /** A soft shadow under the shape. */
  shadow: z.boolean(),
  /** A round avatar beside a message. */
  avatar: z.boolean(),
});

export const graphicMotionBriefSchema = z.object({
  /** "Typing dots for about 0.6 s, then the words pop in; cuts out with the shot". */
  words: words(200),
  /** How long a typing indicator shows before the words, measured; null without one. */
  typingSeconds: z.number().min(0).max(10).nullable(),
});

export const graphicTimingSchema = z.object({
  cue: z.enum(GRAPHIC_TIMING_CUES),
  /** "On the beat after the first cut", "right after the line 'guess where I am'". */
  words: words(200),
});

/** THE design brief of one reel overlay: what read writes, and what aut designs a component from. */
export const graphicBriefSchema = z.object({
  /** The template's text overlay this brief is about. */
  overlayId,
  /**
   * False: footage, not a graphic (a sign, a shop front, a screen, clothes, packaging). A made video leaves it out;
   * the review shows it as removed and can restore it (`template.graphic.set`).
   */
  graphic: z.boolean(),
  /** Why it isn't a graphic, in plain words; null when it is one. */
  reason: words(GRAPHIC_WORDS_MAX).nullable(),
  kind: z.enum(GRAPHIC_BRIEF_KINDS),
  /** What it is in plain words: "an incoming message from a friend". */
  what: words(200),
  role: z.enum(GRAPHIC_STORY_ROLES),
  /** The graphic this one answers, replies to or pays off; null for none. */
  answers: overlayId.nullable(),
  look: graphicLookSchema,
  motion: graphicMotionBriefSchema,
  timing: graphicTimingSchema,
  /** Its relation to the reel's people in plain words: "beside the speaker's head, on the open side". */
  people: z.object({ words: words(200) }),
  source: z.enum(GRAPHIC_BRIEF_SOURCES),
  confidence: unit,
});

export const graphicSystemSchema = z.object({
  /** The look the graphics share, from their measured designs. */
  tokens: z.object({
    platform: z.enum(GRAPHIC_PLATFORMS),
    /** The shapes' fills, most used first. */
    fills: z.array(hexColorSchema).max(8),
    /** The words' colours, most used first. */
    text: z.array(hexColorSchema).max(8),
    /** Corner radius as a share of a shape's height; null without shapes. */
    cornerRadius: z.number().min(0).max(0.5).nullable(),
    font: overlayFontSchema.nullable(),
  }),
  /** The reel's messages in order: each one's side and who sends it. Empty without a conversation. */
  conversation: z
    .array(
      z.object({
        overlayId,
        side: z.enum(CONVERSATION_SIDES),
        speaker: z.enum(CONVERSATION_SPEAKERS),
      }),
    )
    .max(100),
  /**
   * How messages stack: each new one below the last (`down`) or the earlier ones pushed up (`up`), with the gap
   * between two as a share of the canvas's height. Null with fewer than two messages on screen together.
   */
  stack: z.object({ direction: z.enum(GRAPHIC_STACKS), gap: z.number().min(0).max(1) }).nullable(),
  /** The system in a designer's words. */
  words: words(400),
});

/** The breakdown's reading of a reel's graphics: `Template.graphics.reading`. */
export const graphicReadingSchema = z.object({
  version: z.literal(1),
  /** `graphic-brief/<n>`: the prompt the briefs came from. */
  prompt: z.string().regex(GRAPHIC_BRIEF_PROMPT_PATTERN),
  /** Which model wrote the briefs; `local: false` means the reel's frames went to that provider. Null: facts only. */
  model: z
    .object({
      provider: z.string().min(1).max(100),
      model: z.string().min(1).max(200),
      local: z.boolean(),
    })
    .nullable(),
  /** One per overlay the breakdown kept and read, in the reel's order; each overlay once. */
  briefs: z.array(graphicBriefSchema).max(500),
  system: graphicSystemSchema,
});

/** `template.graphic.edit`: the brief's fields the person may change in the review. */
export const graphicBriefPatchSchema = z
  .object({
    kind: z.enum(GRAPHIC_BRIEF_KINDS),
    what: words(200),
    role: z.enum(GRAPHIC_STORY_ROLES),
    look: words(GRAPHIC_WORDS_MAX),
    motion: words(200),
    timing: words(200),
    people: words(200),
  })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, { message: 'A brief edit changes at least one field' });

export type GraphicBriefKind = (typeof GRAPHIC_BRIEF_KINDS)[number];
export type GraphicStoryRole = (typeof GRAPHIC_STORY_ROLES)[number];
export type GraphicPlatform = (typeof GRAPHIC_PLATFORMS)[number];
export type GraphicTimingCue = (typeof GRAPHIC_TIMING_CUES)[number];
export type GraphicBriefSource = (typeof GRAPHIC_BRIEF_SOURCES)[number];
export type ConversationSpeaker = (typeof CONVERSATION_SPEAKERS)[number];
export type GraphicBrief = z.output<typeof graphicBriefSchema>;
export type GraphicSystem = z.output<typeof graphicSystemSchema>;
export type GraphicReading = z.output<typeof graphicReadingSchema>;
export type GraphicBriefPatch = z.output<typeof graphicBriefPatchSchema>;

/** A text overlay's brief in a template's graphics, if the reading has one. */
export function graphicBriefOf(
  graphics: { readonly reading?: GraphicReading | undefined } | undefined,
  id: z.output<typeof overlayId>,
): GraphicBrief | undefined {
  return graphics?.reading?.briefs.find((brief) => brief.overlayId === id);
}

/** Whether the reading says the overlay is footage: a made video leaves it out until the person restores it. */
export function isNotGraphic(
  graphics: { readonly reading?: GraphicReading | undefined } | undefined,
  id: z.output<typeof overlayId>,
): boolean {
  return graphicBriefOf(graphics, id)?.graphic === false;
}
