// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The timeline store's hook (EDT1-CMT): as a timeline is written, inside the same transaction, its comments move
 * with their anchors (comment-follow.ts). It never fails the write: a stored document or a comment row that
 * doesn't read is left alone, because a person's edit matters more than a note's place.
 */
import { upgradeTimeline, type Timeline } from '@taalcut/core';
import { eq } from 'drizzle-orm';
import type { LibraryDatabase } from '../db/database';
import { followComments } from './comment-follow';
import { commentColumns, rowComment } from './comment-rows';
import { timelineComments } from './comment-table';

/** The document the timeline had, as stored. */
export interface StoredDocument {
  readonly document: unknown;
  readonly schemaVersion: number;
}

export function followCommentsOnWrite(
  db: LibraryDatabase,
  before: StoredDocument | undefined,
  after: Timeline,
  now: number,
): void {
  const { orm } = db;
  const rows = orm.select().from(timelineComments).where(eq(timelineComments.timelineId, after.id)).all();
  if (rows.length === 0 || !before) return;
  const earlier = upgradeTimeline(before.document, before.schemaVersion);
  if (!earlier.ok) return;
  const comments = rows.flatMap((row) => {
    const comment = rowComment(row);
    return comment.ok ? [comment.value] : [];
  });
  for (const comment of followComments(comments, { before: earlier.value, after }, now))
    orm
      .update(timelineComments)
      .set(commentColumns(comment))
      .where(eq(timelineComments.id, comment.id))
      .run();
}
