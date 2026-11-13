// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1-CMT: the note a comment batch's first prompt gets (run.started's `comments`): what to do, then each comment,
 * where it is and the person's words, fenced as untrusted: a comment is material, never instructions. Model-facing.
 */
import { COMMENT_TOOLS, wrapUntrusted, type CommentBatch, type CommentBatchItem } from '@taalcut/core';

/** What a comment is on and where: "clip <id>, frames 0–60, at frame 12", "the whole video, frames 0–150". */
export const commentPlace = (item: CommentBatchItem): string => {
  const on =
    item.on === 'timeline'
      ? 'the whole video'
      : item.on === 'range'
        ? 'a stretch of time'
        : `${item.on} ${item.itemId ?? ''}`.trim();
  const span = item.start === null ? ' (gone from the video now)' : `, frames ${item.start}–${item.end}`;
  const at = item.frame !== undefined ? `, at frame ${item.frame}` : '';
  return `${on}${span}${at}`;
};

/** The note the batch's first prompt gets: what to do, then each comment, its words fenced. */
export function commentBatchNote(batch: CommentBatch): string {
  const fps = Math.round((batch.rate.num / batch.rate.den) * 100) / 100;
  const lines = batch.comments.map(
    (item, index) =>
      `${index + 1}. comment ${item.commentId} on ${commentPlace(item)}:\n${wrapUntrusted(item.body, 'user-comment')}`,
  );
  return [
    `The user sent ${batch.comments.length} comment(s) on timeline ${batch.timelineId} (revision ${batch.revision}, ${fps} frames a second; frames are the video's). Each is their note on one thing in the video.`,
    `Make each change, then answer each comment with ${COMMENT_TOOLS.reply}: one line, status resolved when its change is made, or open with the reason when you can't make it. Then hand off.`,
    ...lines,
  ].join('\n');
}
