// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1-CMT: a comment on a timeline, the way a person marks up a cut for a human editor. It is anchored to an edit
 * target (a clip, a line of text, a graphic, a caption, audio, a transition, a stretch of time or the whole video)
 * and may name a moment inside it (`at`, from the anchor's start). "Send N comments to Taalcut" hands every open
 * comment to the agent in one run; the agent makes each change and answers each comment in one line. A comment it
 * can't do goes back to open, with the reason as its reply.
 *
 * Statuses: open (yours to send), sent (with a run), resolved (answered and done), dismissed (you let it go).
 * Comments follow their anchor when items move or are split; when the anchor is deleted the comment becomes a
 * range at the time the item last had (the library does this as the timeline is written).
 *
 * `body` is the person's words and `reply` the agent's: both are untrusted text, shown as plain text and handed to
 * a model only as data.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { idSchema } from '../basics/ids';
import { rationalTimeSchema } from '../time/rational-time';
import { editTargetSchema } from '../timeline/edit-target';

export const COMMENT_STATUSES = ['open', 'sent', 'resolved', 'dismissed'] as const;
export type CommentStatus = (typeof COMMENT_STATUSES)[number];

/** Who wrote the comment: the person, or the agent (a note it left on the cut). */
export const COMMENT_AUTHORS = ['user', 'agent'] as const;
export type CommentAuthor = (typeof COMMENT_AUTHORS)[number];

export const COMMENT_BODY_MAX = 1000;
/** A reply is one line. */
export const COMMENT_REPLY_MAX = 300;
/** What one reply may say it changed. */
export const COMMENT_CHANGE_REFS_MAX = 20;
/** The most comments one timeline keeps (open, sent, resolved and dismissed together). */
export const MAX_TIMELINE_COMMENTS = 500;
/** The most comments one "Send to Taalcut" carries. */
export const MAX_COMMENT_BATCH = 50;

/** The person's words: trimmed, 1–1000 characters. */
export const commentBodySchema = z.string().trim().min(1).max(COMMENT_BODY_MAX);

/** The agent's answer: one line, 1–300 characters (oneLine makes a model's text fit). */
export const commentReplySchema = z
  .string()
  .trim()
  .min(1)
  .max(COMMENT_REPLY_MAX)
  .regex(/^[^\r\n]*$/, { message: 'One line' });

/** Text as one line: every run of white space, line breaks included, becomes one space. */
export function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** A moment inside the anchor, from its start, at the timeline's canvas rate. */
export const commentAtSchema = rationalTimeSchema.refine((time) => time.value >= 0, {
  message: 'Before zero',
});

/**
 * What a reply's change touched: the thing it changed (to jump to), and the timeline's revision once it was made.
 */
export const commentChangeRefSchema = z.object({
  target: editTargetSchema,
  revision: z.int().min(1).optional(),
});
export type CommentChangeRef = z.output<typeof commentChangeRefSchema>;

const commentObjectSchema = z.object({
  id: idSchema<'TimelineComment'>(),
  projectId: idSchema<'Project'>(),
  timelineId: idSchema<'Timeline'>(),
  anchor: editTargetSchema,
  at: commentAtSchema.optional(),
  body: commentBodySchema,
  author: z.enum(COMMENT_AUTHORS),
  status: z.enum(COMMENT_STATUSES),
  reply: commentReplySchema.optional(),
  changeRefs: z.array(commentChangeRefSchema).max(COMMENT_CHANGE_REFS_MAX).optional(),
  /** The run it was last sent to; kept after the run answers, so the chat can be found. */
  runId: idSchema<'AgentRun'>().optional(),
  createdAt: z.int().nonnegative(),
  updatedAt: z.int().nonnegative(),
});

/** Problems a stored or sent comment must not have, as messages (also the schema's refinements). */
export function commentProblems(comment: z.output<typeof commentObjectSchema>): string[] {
  const problems: string[] = [];
  if (comment.anchor.timelineId !== comment.timelineId) problems.push('The anchor is on another timeline');
  for (const ref of comment.changeRefs ?? [])
    if (ref.target.timelineId !== comment.timelineId) problems.push('A change is on another timeline');
  return problems;
}

export const timelineCommentSchema = commentObjectSchema.superRefine((comment, ctx) => {
  for (const message of commentProblems(comment)) ctx.addIssue({ code: 'custom', message });
});
export type TimelineComment = z.output<typeof timelineCommentSchema>;
