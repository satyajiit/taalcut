// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The `comments` agent tools (EDT1-CMT; core's comment-tools.ts has their schemas). `comments.list` reads a timeline's
 * comments, open and sent by default, each flat with where it is now. `comments.reply` answers one: one line, resolved
 * or still open, and the items its change touched, which it turns into change refs on the comment's timeline (an id
 * that isn't there is left out) with the timeline's revision now. The person's words are untrusted in the output.
 */
import { createHash } from 'node:crypto';
import {
  COMMENT_COMMANDS,
  COMMENT_TOOLS,
  commentReplyToolInputSchema,
  commentReplyToolOutputSchema,
  commentsListToolInputSchema,
  commentsListToolOutputSchema,
  commentToolView,
  defineTool,
  defineToolModule,
  editItemMap,
  NO_TOOL_RETRY,
  ok,
  oneLine,
  upgradeTimeline,
  type AnyTool,
  type AsyncResult,
  type CommentChangeRef,
  type CommentStore,
  type Timeline,
  type TimelineId,
  type TimelineStore,
  type ToolModule,
} from '@taalcut/core';

export interface CommentToolDeps {
  readonly store: CommentStore;
  readonly timelines: Pick<TimelineStore, 'get'>;
}

export function commentToolModule(deps: CommentToolDeps): ToolModule {
  async function read(timelineId: TimelineId): AsyncResult<Timeline> {
    const stored = await deps.timelines.get(timelineId);
    return stored.ok ? upgradeTimeline(stored.value.json, stored.value.schemaVersion) : stored;
  }

  const list = defineTool({
    name: COMMENT_TOOLS.list,
    version: '1.0.0',
    description:
      "Reads a timeline's comments (open and sent by default): what each is on (a clip, text, graphic, caption, audio, transition, a stretch of time or the whole video), its item id, where it is now in frames, the moment it points at, and the person's words.",
    summary: "Reads a timeline's comments with where each one is.",
    tags: ['read', 'comments'],
    input: commentsListToolInputSchema,
    output: commentsListToolOutputSchema,
    costClass: 'local',
    sideEffect: 'read',
    timeoutMs: 10_000,
    retry: { maxAttempts: 2, initialDelayMs: 200 },
    run: async ({ timelineId, statuses }) => {
      const timeline = await read(timelineId);
      if (!timeline.ok) return timeline;
      const comments = await deps.store.list(timelineId, { statuses: statuses ?? ['open', 'sent'] });
      if (!comments.ok) return comments;
      const items = editItemMap(timeline.value);
      return ok({
        timelineId,
        revision: timeline.value.revision,
        rate: { num: timeline.value.canvas.rate.num, den: timeline.value.canvas.rate.den },
        comments: comments.value.map((comment) => commentToolView(comment, timeline.value, items)),
      });
    },
  });

  const reply = defineTool({
    name: COMMENT_TOOLS.reply,
    version: '1.0.0',
    description:
      'Answers one comment in one line, after you made its change (status resolved) or when you could not (status open, with the reason). Name the ids of the items your change touched in changed.',
    summary: 'Answers one comment: resolved, or open with the reason.',
    tags: ['comments'],
    input: commentReplyToolInputSchema,
    output: commentReplyToolOutputSchema,
    costClass: 'local',
    sideEffect: 'write',
    command: COMMENT_COMMANDS.reply,
    // The same answer to the same comment is one action.
    idempotencyKey: (input) =>
      `${COMMENT_TOOLS.reply}:${createHash('sha256').update(JSON.stringify(input)).digest('hex')}`,
    timeoutMs: 10_000,
    retry: NO_TOOL_RETRY,
    run: async (input, ctx) => {
      const comment = await deps.store.get(input.commentId);
      if (!comment.ok) return comment;
      const { projectId, timelineId } = comment.value;
      const timeline = await read(timelineId);
      if (!timeline.ok) return timeline;
      const items = editItemMap(timeline.value);
      const revision = timeline.value.revision;
      const changeRefs: CommentChangeRef[] = [...new Set(input.changed ?? [])].flatMap((id) => {
        const place = items.get(id);
        return place ? [{ target: place.target, revision }] : [];
      });
      const done = await ctx.dispatch({
        projectId,
        timelineId,
        commentId: input.commentId,
        reply: oneLine(input.reply),
        status: input.status,
        changeRefs,
      });
      return done.ok ? ok({ commentId: input.commentId, status: input.status }) : done;
    },
  });

  return defineToolModule({ id: 'comments', tools: [list as AnyTool, reply as AnyTool] });
}
