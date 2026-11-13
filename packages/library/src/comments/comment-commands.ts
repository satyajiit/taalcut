// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * COMMENT_COMMANDS (EDT1-CMT) on core's bus. Each joins its project's history; every write passes the command's
 * context, so it commits with the audit row or not at all, and `library.changed` (entity 'comment') goes out once
 * it has. add, edit, remove and setStatus restore the previous comment when undone; send has no inverse; undoing a
 * reply puts the comment back to open, without the reply, because the change it answered went with it.
 *
 * Who may write what (core's comment-commands.ts): a person may do anything; anyone else (the agent, an MCP client)
 * writes `agent` comments, changes or removes only those, and may reopen a sent comment, which is how a run gives
 * back what it didn't answer. Nothing answers a dismissed comment.
 */
import {
  COMMENT_COMMANDS,
  commentCommandPayloads,
  CommentClosed,
  CommentNotYours,
  CommentsFull,
  CommentTargetGone,
  createCommitAnnouncer,
  defineCommand,
  editTargetSpan,
  err,
  MAX_TIMELINE_COMMENTS,
  ok,
  PERSON_SOURCES,
  upgradeTimeline,
  ValidationError,
  type AnyCommand,
  type Clock,
  type CommandContext,
  type CommentStore,
  type CommitAnnouncer,
  type EditTarget,
  type ProjectId,
  type Result,
  type TimelineComment,
  type TimelineCommentId,
  type TimelineId,
  type TimelineStore,
} from '@taalcut/core';
import { commentRestore } from './comment-restore';

const N = COMMENT_COMMANDS;
const P = commentCommandPayloads;

export interface CommentCommandDeps {
  readonly store: CommentStore;
  /** To check that what a comment is on is on the timeline now. */
  readonly timelines: Pick<TimelineStore, 'get'>;
  readonly clock: Clock;
}

export const isPerson = (context: Pick<CommandContext, 'source'>) =>
  (PERSON_SOURCES as readonly string[]).includes(context.source);

/** A person's comment is theirs alone to change. */
function mayChange(context: CommandContext, comment: TimelineComment): Result<void> {
  return comment.author === 'user' && !isPerson(context) ? err(CommentNotYours()) : ok(undefined);
}

export function createCommentCommands({ store, timelines, clock }: CommentCommandDeps) {
  const announcer: CommitAnnouncer = createCommitAnnouncer();
  const changed = (
    context: CommandContext,
    projectId: ProjectId,
    change: 'created' | 'updated' | 'deleted',
    ids: readonly TimelineCommentId[],
  ) => announcer.note(context, { projectId, entity: 'comment', change, ids });

  /** The comment, on the timeline and in the project the payload names. */
  async function current(
    where: { projectId: ProjectId; timelineId: TimelineId },
    commentId: TimelineCommentId,
  ) {
    const found = await store.get(commentId);
    if (!found.ok) return found;
    const { projectId, timelineId } = found.value;
    return projectId === where.projectId && timelineId === where.timelineId
      ? found
      : err(ValidationError({ field: 'commentId' }));
  }

  /** `anchor` is on the timeline now. */
  async function onTimeline(
    projectId: ProjectId,
    timelineId: TimelineId,
    anchor: EditTarget,
  ): Promise<Result<void>> {
    const stored = await timelines.get(timelineId);
    if (!stored.ok) return stored;
    if (stored.value.summary.projectId !== projectId) return err(ValidationError({ field: 'projectId' }));
    const timeline = upgradeTimeline(stored.value.json, stored.value.schemaVersion);
    if (!timeline.ok) return timeline;
    return editTargetSpan(timeline.value, anchor) ? ok(undefined) : err(CommentTargetGone());
  }

  const where = (comment: TimelineComment) => ({
    projectId: comment.projectId,
    timelineId: comment.timelineId,
  });

  /** Writes `next` and notes it; the inverse puts `previous` back. */
  async function replace(context: CommandContext, previous: TimelineComment, next: TimelineComment) {
    const stored = await store.put(next, context);
    if (!stored.ok) return stored;
    changed(context, next.projectId, 'updated', [next.id]);
    return ok({
      result: { commentId: next.id },
      inverse: {
        name: N.restore,
        payload: { ...where(previous), commentId: previous.id, comment: previous },
      },
    });
  }

  const add = defineCommand({
    name: N.add,
    payload: P[N.add],
    sideEffect: 'write',
    handle: async ({ projectId, timelineId, commentId, anchor, at, body }, context) => {
      const there = await onTimeline(projectId, timelineId, anchor);
      if (!there.ok) return there;
      const kept = await store.count(timelineId);
      if (!kept.ok) return kept;
      if (kept.value >= MAX_TIMELINE_COMMENTS) return err(CommentsFull({ limit: MAX_TIMELINE_COMMENTS }));
      const now = clock.now();
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
      const stored = await store.create(comment, context);
      if (!stored.ok) return stored;
      changed(context, projectId, 'created', [commentId]);
      return ok({
        result: { commentId },
        inverse: { name: N.restore, payload: { projectId, timelineId, commentId, comment: null } },
      });
    },
  });

  const edit = defineCommand({
    name: N.edit,
    payload: P[N.edit],
    sideEffect: 'write',
    handle: async ({ projectId, timelineId, commentId, patch }, context) => {
      const found = await current({ projectId, timelineId }, commentId);
      if (!found.ok) return found;
      const allowed = mayChange(context, found.value);
      if (!allowed.ok) return allowed;
      if (patch.anchor) {
        if (patch.anchor.timelineId !== timelineId) return err(ValidationError({ field: 'anchor' }));
        const there = await onTimeline(projectId, timelineId, patch.anchor);
        if (!there.ok) return there;
      }
      const { at: _at, ...rest } = found.value;
      const at = patch.at === undefined ? found.value.at : (patch.at ?? undefined);
      const next: TimelineComment = {
        ...rest,
        ...(patch.body !== undefined ? { body: patch.body } : {}),
        ...(patch.anchor ? { anchor: patch.anchor } : {}),
        ...(at ? { at } : {}),
        updatedAt: clock.now(),
      };
      return replace(context, found.value, next);
    },
  });

  const remove = defineCommand({
    name: N.remove,
    payload: P[N.remove],
    sideEffect: 'write',
    handle: async ({ projectId, timelineId, commentId }, context) => {
      const found = await current({ projectId, timelineId }, commentId);
      if (!found.ok) return found;
      const allowed = mayChange(context, found.value);
      if (!allowed.ok) return allowed;
      const removed = await store.remove(commentId, context);
      if (!removed.ok) return removed;
      changed(context, projectId, 'deleted', [commentId]);
      return ok({
        result: { commentId },
        inverse: { name: N.restore, payload: { projectId, timelineId, commentId, comment: found.value } },
      });
    },
  });

  const setStatus = defineCommand({
    name: N.setStatus,
    payload: P[N.setStatus],
    sideEffect: 'write',
    handle: async ({ projectId, timelineId, commentId, status }, context) => {
      const found = await current({ projectId, timelineId }, commentId);
      if (!found.ok) return found;
      const comment = found.value;
      // Anyone may give back a sent comment; the rest is the author's (a person may do anything).
      const release = status === 'open' && comment.status === 'sent';
      if (!release) {
        const allowed = mayChange(context, comment);
        if (!allowed.ok) return allowed;
        if (!isPerson(context) && status === 'open' && comment.status !== 'open')
          return err(CommentClosed({ status: comment.status }));
      }
      if (comment.status === status) return ok({ result: { commentId } });
      return replace(context, comment, { ...comment, status, updatedAt: clock.now() });
    },
  });

  const send = defineCommand({
    name: N.send,
    payload: P[N.send],
    sideEffect: 'write',
    handle: async ({ projectId, timelineId, commentIds, runId }, context) => {
      const now = clock.now();
      const sent: TimelineCommentId[] = [];
      for (const commentId of new Set(commentIds)) {
        const found = await current({ projectId, timelineId }, commentId);
        if (!found.ok) {
          if (found.error.code === 'core.not_found') continue;
          return found;
        }
        if (found.value.status !== 'open') continue;
        const stored = await store.put({ ...found.value, status: 'sent', runId, updatedAt: now }, context);
        if (!stored.ok) return stored;
        sent.push(commentId);
      }
      if (sent.length > 0) changed(context, projectId, 'updated', sent);
      return ok({ result: { sent } });
    },
  });

  const reply = defineCommand({
    name: N.reply,
    payload: P[N.reply],
    sideEffect: 'write',
    handle: async ({ projectId, timelineId, commentId, reply: words, status, changeRefs }, context) => {
      const found = await current({ projectId, timelineId }, commentId);
      if (!found.ok) return found;
      const comment = found.value;
      if (comment.status === 'dismissed') return err(CommentClosed({ status: comment.status }));
      if (changeRefs.some((ref) => ref.target.timelineId !== timelineId))
        return err(ValidationError({ field: 'changeRefs' }));
      const { changeRefs: _refs, ...rest } = comment;
      const next: TimelineComment = {
        ...rest,
        reply: words,
        status,
        ...(changeRefs.length > 0 ? { changeRefs } : {}),
        updatedAt: clock.now(),
      };
      // Undone with the run's changes, the comment is open again and says nothing.
      const { reply: _said, ...unanswered } = comment;
      const before: TimelineComment = {
        ...unanswered,
        status: comment.status === 'sent' ? 'open' : comment.status,
      };
      return replace(context, before, next);
    },
  });

  const releaseRun = defineCommand({
    name: N.releaseRun,
    payload: P[N.releaseRun],
    sideEffect: 'write',
    lifecycle: true,
    handle: async ({ projectId, timelineId, commentIds, runId }, context) => {
      const released: TimelineCommentId[] = [];
      for (const commentId of new Set(commentIds)) {
        const found = await current({ projectId, timelineId }, commentId);
        if (!found.ok) {
          if (found.error.code === 'core.not_found') continue;
          return found;
        }
        if (found.value.status !== 'sent' || found.value.runId !== runId) continue;
        const stored = await store.put({ ...found.value, status: 'open', updatedAt: clock.now() }, context);
        if (!stored.ok) return stored;
        released.push(commentId);
      }
      if (released.length) changed(context, projectId, 'updated', released);
      return ok({ result: { released: released.length } });
    },
  });

  const restore = commentRestore({ store, changed });

  const all: AnyCommand[] = [add, edit, remove, setStatus, send, reply, restore, releaseRun];
  return {
    add,
    edit,
    remove,
    setStatus,
    send,
    reply,
    restore,
    releaseRun,
    /** Every comment command, for `bus.register(...all)`. */
    all,
    /** Sends `library.changed` for each committed comment command (call once with the agent's bus). */
    announce: (
      bus: Parameters<CommitAnnouncer['attach']>[0],
      events: Parameters<CommitAnnouncer['attach']>[1],
    ) => announcer.attach(bus, events),
  };
}

export type CommentCommands = ReturnType<typeof createCommentCommands>;
