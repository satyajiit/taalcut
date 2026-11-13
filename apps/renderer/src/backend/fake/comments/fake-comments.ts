// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The editor's comments in the preview (EDT1-CMT): appContract.comments (`list`, `watch`) and COMMENT_COMMANDS as the
 * library answers them. add needs its anchor on the timeline now and the timeline under 500 comments; add, edit,
 * remove and setStatus are undone by comments.restore with the whole previous comment; send has no inverse; reply's
 * undo opens the comment again with no reply. Only a person changes a person's comment; anyone may give back a sent
 * one; nothing answers a dismissed one. Each committed change emits `library.changed` (entity comment). Unlike the
 * library, comments here don't move with their anchors when the cut changes.
 *
 * Scenarios (`taalcut.fake` → `comments`): 'seeded' (three comments on the first project's first video: open,
 * with Taalcut and done).
 */
import {
  appContract,
  COMMENT_COMMANDS,
  commentCommandPayloads,
  CommentClosed,
  CommentNotYours,
  CommentsFull,
  CommentTargetGone,
  defineCommand,
  editTargetSpan,
  err,
  implementContract,
  MAX_TIMELINE_COMMENTS,
  NotFoundError,
  ok,
  PERSON_SOURCES,
  type AnyCommand,
  type CommandContext,
  type EventBus,
  type Result,
  type Timeline,
  type TimelineComment,
  type TimelineCommentId,
  type TimelineId,
} from '@taalcut/core';
import { watched } from '../watch';
import { commentsSeed } from './comments-seed';

export type FakeCommentsScenario = 'seeded';

export interface FakeCommentsOptions {
  readonly scenario?: FakeCommentsScenario;
}

export interface FakeCommentsDeps {
  readonly now: () => number;
  readonly events: EventBus;
  readonly timelines: { get(id: TimelineId): Timeline | undefined; list?(): readonly Timeline[] };
}

const N = COMMENT_COMMANDS;
const P = commentCommandPayloads;
const isPerson = (context: CommandContext) => (PERSON_SOURCES as readonly string[]).includes(context.source);

export function createFakeComments(deps: FakeCommentsDeps, options: FakeCommentsOptions = {}) {
  const comments = new Map<string, TimelineComment>();
  if (options.scenario === 'seeded' && deps.timelines.list)
    for (const comment of commentsSeed(deps.timelines.list(), deps.now())) comments.set(comment.id, comment);
  const all = watched(() => [...comments.values()]);
  const listOf = (timelineId: TimelineId) =>
    [...comments.values()]
      .filter((comment) => comment.timelineId === timelineId)
      .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));

  const changed = (
    comment: Pick<TimelineComment, 'projectId' | 'id'>,
    change: 'created' | 'updated' | 'deleted',
  ) => {
    all.notify();
    deps.events.emit('library.changed', {
      projectId: comment.projectId,
      entity: 'comment',
      change,
      ids: [comment.id],
    });
  };
  const current = (where: { timelineId: TimelineId }, id: TimelineCommentId): Result<TimelineComment> => {
    const found = comments.get(id);
    return found && found.timelineId === where.timelineId
      ? ok(found)
      : err(NotFoundError({ entity: 'comment', id }));
  };
  const mayChange = (context: CommandContext, comment: TimelineComment): Result<void> =>
    comment.author === 'user' && !isPerson(context) ? err(CommentNotYours()) : ok(undefined);
  const restoreTo = (comment: TimelineComment | null, where: TimelineComment) => ({
    name: N.restore,
    payload: { projectId: where.projectId, timelineId: where.timelineId, commentId: where.id, comment },
  });
  /** Writes `next`; undone, `previous` comes back. */
  const replace = (previous: TimelineComment, next: TimelineComment) => {
    comments.set(next.id, next);
    changed(next, 'updated');
    return ok({ result: { commentId: next.id }, inverse: restoreTo(previous, previous) });
  };

  const add = defineCommand({
    name: N.add,
    payload: P[N.add],
    sideEffect: 'write',
    handle: ({ projectId, timelineId, commentId, anchor, at, body }, context) => {
      const timeline = deps.timelines.get(timelineId);
      if (!timeline) return err(NotFoundError({ entity: 'timeline', id: timelineId }));
      if (!editTargetSpan(timeline, anchor)) return err(CommentTargetGone());
      if (listOf(timelineId).length >= MAX_TIMELINE_COMMENTS)
        return err(CommentsFull({ limit: MAX_TIMELINE_COMMENTS }));
      const now = deps.now();
      const comment: TimelineComment = {
        id: commentId,
        projectId,
        timelineId,
        anchor,
        ...(at ? { at } : {}),
        body,
        author: isPerson(context) ? 'user' : 'agent',
        status: 'open',
        createdAt: now,
        updatedAt: now,
      };
      comments.set(commentId, comment);
      changed(comment, 'created');
      return ok({ result: { commentId }, inverse: restoreTo(null, comment) });
    },
  });

  const edit = defineCommand({
    name: N.edit,
    payload: P[N.edit],
    sideEffect: 'write',
    handle: ({ timelineId, commentId, patch }, context) => {
      const found = current({ timelineId }, commentId);
      if (!found.ok) return found;
      const allowed = mayChange(context, found.value);
      if (!allowed.ok) return allowed;
      const { at: _at, ...rest } = found.value;
      const at = patch.at === null ? undefined : (patch.at ?? found.value.at);
      return replace(found.value, {
        ...rest,
        ...(patch.body ? { body: patch.body } : {}),
        ...(patch.anchor ? { anchor: patch.anchor } : {}),
        ...(at ? { at } : {}),
        updatedAt: deps.now(),
      });
    },
  });

  const remove = defineCommand({
    name: N.remove,
    payload: P[N.remove],
    sideEffect: 'write',
    handle: ({ timelineId, commentId }, context) => {
      const found = current({ timelineId }, commentId);
      if (!found.ok) return found;
      const allowed = mayChange(context, found.value);
      if (!allowed.ok) return allowed;
      comments.delete(commentId);
      changed(found.value, 'deleted');
      return ok({ result: { commentId }, inverse: restoreTo(found.value, found.value) });
    },
  });

  const setStatus = defineCommand({
    name: N.setStatus,
    payload: P[N.setStatus],
    sideEffect: 'write',
    handle: ({ timelineId, commentId, status }, context) => {
      const found = current({ timelineId }, commentId);
      if (!found.ok) return found;
      const comment = found.value;
      if (!(status === 'open' && comment.status === 'sent')) {
        const allowed = mayChange(context, comment);
        if (!allowed.ok) return allowed;
        if (!isPerson(context) && status === 'open' && comment.status !== 'open')
          return err(CommentClosed({ status: comment.status }));
      }
      if (comment.status === status) return ok({ result: { commentId } });
      return replace(comment, { ...comment, status, updatedAt: deps.now() });
    },
  });

  const send = defineCommand({
    name: N.send,
    payload: P[N.send],
    sideEffect: 'write',
    handle: ({ timelineId, commentIds, runId }) => {
      const sent: TimelineCommentId[] = [];
      for (const commentId of new Set(commentIds)) {
        const found = current({ timelineId }, commentId);
        if (!found.ok || found.value.status !== 'open') continue;
        comments.set(commentId, { ...found.value, status: 'sent', runId, updatedAt: deps.now() });
        changed(found.value, 'updated');
        sent.push(commentId);
      }
      return ok({ result: { sent } });
    },
  });

  const reply = defineCommand({
    name: N.reply,
    payload: P[N.reply],
    sideEffect: 'write',
    handle: ({ timelineId, commentId, reply: words, status, changeRefs }) => {
      const found = current({ timelineId }, commentId);
      if (!found.ok) return found;
      const comment = found.value;
      if (comment.status === 'dismissed') return err(CommentClosed({ status: comment.status }));
      const { changeRefs: _refs, reply: _said, ...unanswered } = comment;
      const before = {
        ...unanswered,
        status: comment.status === 'sent' ? ('open' as const) : comment.status,
      };
      return replace(before, {
        ...unanswered,
        reply: words,
        status,
        ...(changeRefs.length > 0 ? { changeRefs } : {}),
        updatedAt: deps.now(),
      });
    },
  });

  const restore = defineCommand({
    name: N.restore,
    payload: P[N.restore],
    sideEffect: 'write',
    internal: true,
    handle: ({ commentId, comment }) => {
      const was = comments.get(commentId) ?? null;
      if (comment) comments.set(commentId, comment);
      else comments.delete(commentId);
      if (was || comment) changed((comment ?? was)!, comment ? 'updated' : 'deleted');
      return ok({ result: { commentId }, inverse: was ? restoreTo(was, was) : undefined });
    },
  });

  const os = implementContract(appContract.comments);
  const router = os.router({
    list: os.list.handler(({ input }) =>
      listOf(input.timelineId).filter(
        (comment) => !input.statuses || input.statuses.includes(comment.status),
      ),
    ),
    watch: os.watch.handler(async function* ({ input, signal }) {
      if (!deps.timelines.get(input.timelineId)) throw new Error(`fake: no timeline ${input.timelineId}`);
      let shown = '';
      for await (const _ of all.stream(signal)) {
        const list = listOf(input.timelineId);
        const text = JSON.stringify(list);
        if (text === shown) continue;
        shown = text;
        yield list;
      }
    }),
  });

  const commands: AnyCommand[] = [add, edit, remove, setStatus, send, reply, restore];
  return {
    router,
    commands,
    /** Every comment on `timelineId`, oldest first (tests and the fake agent read them). */
    list: listOf,
    get: (id: string) => comments.get(id),
  };
}

export type FakeComments = ReturnType<typeof createFakeComments>;
