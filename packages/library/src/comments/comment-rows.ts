// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Comment rows ↔ core's TimelineComment (EDT1-CMT). Every comment written or read goes through core's
 * timelineCommentSchema, so a row that stopped fitting it reads as core.validation, never as half a comment.
 */
import {
  err,
  ok,
  timelineCommentSchema,
  ValidationError,
  type Result,
  type TimelineComment,
} from '@taalcut/core';
import type { CommentRow } from './comment-table';

export function parsedComment(value: unknown): Result<TimelineComment> {
  const parsed = timelineCommentSchema.safeParse(value);
  return parsed.success
    ? ok(parsed.data)
    : err(ValidationError({ field: 'comment' }, { detail: parsed.error.message.slice(0, 2000) }));
}

export function commentColumns(comment: TimelineComment): CommentRow {
  return {
    id: comment.id,
    projectId: comment.projectId,
    timelineId: comment.timelineId,
    anchor: comment.anchor,
    at: comment.at ?? null,
    body: comment.body,
    author: comment.author,
    status: comment.status,
    reply: comment.reply ?? null,
    changeRefs: comment.changeRefs ?? null,
    runId: comment.runId ?? null,
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
  };
}

export function rowComment(row: CommentRow): Result<TimelineComment> {
  return parsedComment({
    id: row.id,
    projectId: row.projectId,
    timelineId: row.timelineId,
    anchor: row.anchor,
    ...(row.at !== null ? { at: row.at } : {}),
    body: row.body,
    author: row.author,
    status: row.status,
    ...(row.reply !== null ? { reply: row.reply } : {}),
    ...(row.changeRefs !== null ? { changeRefs: row.changeRefs } : {}),
    ...(row.runId !== null ? { runId: row.runId } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

/** Every row as a comment; the first that doesn't parse fails the read. */
export function rowComments(rows: readonly CommentRow[]): Result<TimelineComment[]> {
  const out: TimelineComment[] = [];
  for (const row of rows) {
    const comment = rowComment(row);
    if (!comment.ok) return comment;
    out.push(comment.value);
  }
  return ok(out);
}
