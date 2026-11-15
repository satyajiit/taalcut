// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * CAP1: a post caption, the text a person pastes under their post on a platform. Never the words on the video:
 * those are `captions` (render's caption track). The AI states a caption's parts, a tool builds the text and
 * holds it to the platform's rule; the rule is structure only (counts, order, a credit line) and lives here, in
 * one table. Another platform is another entry in `POST_CAPTION_RULES`, never a new code path.
 *
 * The saved caption is part of the video's timeline document (`timeline.postCaptions`, one per platform), beside
 * its covers. What checks and builds a text is post-caption-rule.ts.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { ulidSchema } from '../basics/ids';

/** The platforms a caption can be written for: the keys of `POST_CAPTION_RULES`. */
export const POST_CAPTION_PLATFORMS = ['instagram'] as const;
export type PostCaptionPlatform = (typeof POST_CAPTION_PLATFORMS)[number];

/** The blocks a caption is assembled from, each its own paragraph. */
export const POST_CAPTION_BLOCKS = ['body', 'credit', 'hashtags', 'keywords'] as const;
export type PostCaptionBlock = (typeof POST_CAPTION_BLOCKS)[number];

/** A platform's rule: structure only. The words are the model's, or the person's. */
export interface PostCaptionRule {
  /** The platform's own name, a proper noun: shown as written in every language. */
  readonly name: string;
  /** The longest caption the platform takes, in characters. */
  readonly maxLength: number;
  /** About where the feed cuts a caption ("… more"). A guide for the first line; nothing is refused by it. */
  readonly feedCut: number;
  /** Hashtags in the whole caption, wherever they are typed. */
  readonly hashtags: { readonly min: number; readonly max: number };
  /** Search phrases, as one bracketed list. */
  readonly keywords: { readonly min: number; readonly max: number };
  /** The credit line. The tool adds it, once, when the person keeps the credit on; the model never types it. */
  readonly credit: string;
  /** The blocks in the platform's order. A rule whose last block is `keywords` wants that list at the very end. */
  readonly order: readonly PostCaptionBlock[];
}

/**
 * The one definition of each platform's rule (CAP1). Instagram's is the owner's: one to four hashtags in the
 * whole caption, the search phrases as one bracketed list at the very end, the credit line once, and Instagram's
 * own limit of 2,200 characters. Its feed shows about 125 characters before "… more".
 */
export const POST_CAPTION_RULES = {
  instagram: {
    name: 'Instagram',
    maxLength: 2200,
    feedCut: 125,
    hashtags: { min: 1, max: 4 },
    keywords: { min: 3, max: 10 },
    credit: 'Created with @taalcut.app',
    order: ['body', 'credit', 'hashtags', 'keywords'],
  },
} as const satisfies Record<PostCaptionPlatform, PostCaptionRule>;

/** The rule of a platform, typed loosely so code reads any entry the same way. */
export const postCaptionRule = (platform: PostCaptionPlatform): PostCaptionRule =>
  POST_CAPTION_RULES[platform];

const platform = z.enum(POST_CAPTION_PLATFORMS);

/** The longest note a caption request carries: one line of the user's own words. */
export const POST_CAPTION_NOTE_MAX = 200;
/**
 * A caption asked for in the editor's caption panel ("Generate with AI"): the platform picked there and, when
 * the user wrote one, what the caption should say. It travels on the chat message
 * (`messageExtrasShape.postCaption`), so the platform the AI owes is data and is never read out of the words.
 */
export const postCaptionRequestSchema = z.object({
  platform,
  note: z.string().trim().min(1).max(POST_CAPTION_NOTE_MAX).optional(),
});
export type PostCaptionRequest = z.output<typeof postCaptionRequestSchema>;

/**
 * The longest caption a video keeps. Above every platform's own limit on purpose: a person's edit that runs
 * long is kept and flagged, never refused.
 */
export const POST_CAPTION_TEXT_MAX = 5000;
export const POST_CAPTION_WRITERS = ['ai', 'person'] as const;
export type PostCaptionWriter = (typeof POST_CAPTION_WRITERS)[number];

/** A caption as the video keeps it: the whole text, ready to paste, and who last wrote it. */
export const savedPostCaptionSchema = z.object({
  platform,
  text: z.string().min(1).max(POST_CAPTION_TEXT_MAX),
  writtenBy: z.enum(POST_CAPTION_WRITERS),
});
export type SavedPostCaption = z.output<typeof savedPostCaptionSchema>;

/** The most captions a timeline keeps: one per platform, with room for the table to grow. */
export const MAX_POST_CAPTIONS = 8;

/**
 * The parts the AI states (`timeline.setPostCaption`, the tool). Their bounds are loose on purpose: the rule's
 * own counts are held by post-caption-rule.ts, which answers in words the model can act on.
 */
export const postCaptionPartsSchema = z.object({
  body: z.string().max(POST_CAPTION_TEXT_MAX),
  hashtags: z.array(z.string().max(80)).max(30),
  keywords: z.array(z.string().max(120)).max(30),
});
export type PostCaptionParts = z.output<typeof postCaptionPartsSchema>;

/**
 * `timeline.setPostCaption` (the command; handler: @taalcut/timeline): the video's caption for one platform,
 * replaced by `text`, or removed by null. It changes nothing else in the timeline. `writtenBy` defaults to who
 * dispatched it (the agent is 'ai'); the command's own inverse names it to put a caption back as it was.
 */
export const POST_CAPTION_COMMAND = 'timeline.setPostCaption';
export const setPostCaptionPayloadSchema = z.object({
  projectId: ulidSchema('Project'),
  timelineId: ulidSchema('Timeline'),
  revision: z.int().positive().optional(),
  platform,
  text: z.string().trim().min(1).max(POST_CAPTION_TEXT_MAX).nullable(),
  writtenBy: z.enum(POST_CAPTION_WRITERS).optional(),
});
export type SetPostCaptionPayload = z.output<typeof setPostCaptionPayloadSchema>;

/** What the tool answers: the caption as assembled and saved, for the model to show the person. */
export const postCaptionResultSchema = z.object({
  timelineId: ulidSchema('Timeline'),
  revision: z.int().positive(),
  platform,
  text: z.string().min(1).max(POST_CAPTION_TEXT_MAX),
});
export type PostCaptionResult = z.output<typeof postCaptionResultSchema>;
