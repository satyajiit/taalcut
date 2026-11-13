// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FIX-CMT: the edit eval's comment cases. The person's comments are added from the editor (comments.add, as the UI
 * does), read into a batch the way the chat reads them when "Send N comments to Taalcut" is pressed (the library's
 * batches), and the run is the agent's batch run: no docked context, the batch in its start. A case passes when its
 * checker does and every comment was answered, resolved, in a line.
 */
import { COMMENT_COMMANDS, type CommandOrigin, type CommentBatch, type Timeline, type TimelineCommentId } from '@taalcut/core';
import type { EditCase } from './case-types';
import { fixedId } from './ids';
import { seconds, targetOf } from './targets';
import type { EditWorld } from './world';

const UI: CommandOrigin = { source: 'ui', actor: 'user' };

/** The case's comments added to the video, by fixed ids (a recorded session names them). */
export async function addComments(world: EditWorld, edit: EditCase, timeline: Timeline): Promise<TimelineCommentId[]> {
  const ids: TimelineCommentId[] = [];
  for (const [index, comment] of (edit.comments ?? []).entries()) {
    const commentId = fixedId<'TimelineComment'>('01K8EK', index + 1);
    const anchor = comment.on === 'video' ? { kind: 'timeline', timelineId: timeline.id } : targetOf(comment.on, timeline);
    const added = await world.bus.dispatch(
      COMMENT_COMMANDS.add,
      {
        projectId: world.projectId,
        timelineId: world.timelineId,
        commentId,
        anchor,
        ...(comment.at !== undefined ? { at: seconds(comment.at) } : {}),
        body: comment.body,
      },
      UI,
    );
    if (!added.ok) throw new Error(`${edit.id} comment ${index + 1}: ${added.error.code} ${added.error.detail ?? ''}`);
    ids.push(commentId);
  }
  return ids;
}

/** The batch the chat would send: the open ones among `ids`, where each is now. */
export async function openBatch(world: EditWorld, ids: readonly TimelineCommentId[]): Promise<CommentBatch> {
  const batch = await world.batches.open(ids);
  if (!batch.ok || !batch.value) throw new Error(`No batch for ${ids.join(', ')}`);
  return batch.value;
}

/** Each comment answered, resolved, with a reply: the conditions the case's verdict adds. */
export async function answered(world: EditWorld, ids: readonly TimelineCommentId[]) {
  const conditions: (readonly [boolean, string])[] = [];
  for (const [index, id] of ids.entries()) {
    const comment = await world.comments.get(id);
    const status = comment.ok ? comment.value.status : 'gone';
    const reply = comment.ok ? (comment.value.reply ?? '') : '';
    conditions.push([status === 'resolved' && reply.trim() !== '', `comment ${index + 1} is ${status}${reply ? `: "${reply}"` : ', unanswered'}`]);
  }
  return conditions;
}
