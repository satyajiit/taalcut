// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { ConflictError, err, type CommandId, type ConversationId, type ProjectId } from '@taalcut/core';
import { eq } from 'drizzle-orm';
import type { LibraryDatabase } from '../db/database';
import { projects } from '../schema/chat';
import { canNameProjectFromConversation } from './automatic-project-name';
import { found, inTransaction } from './shared';

export interface ProjectNameGuard {
  expectedName?: string;
  fromConversation?: ConversationId;
  /** The audit transaction records the current command before applying its staged rename. */
  commandId?: CommandId;
  /** Trusted command history replay, never accepted from a rename payload. */
  replay?: 'redo';
}

/** The guards and write share a transaction, including when another command bus changed the project. */
export function writeProjectName(
  db: LibraryDatabase,
  id: ProjectId,
  name: string,
  options: ProjectNameGuard,
) {
  return inTransaction(db, 'project', () => {
    const before = found(db.orm.select().from(projects).where(eq(projects.id, id)).get(), 'project', id);
    if (!before.ok) return before;
    if (
      (options.expectedName !== undefined && before.value.name !== options.expectedName) ||
      (options.fromConversation !== undefined &&
        options.replay !== 'redo' &&
        !canNameProjectFromConversation(db, before.value, {
          name,
          conversationId: options.fromConversation,
          ...(options.commandId ? { commandId: options.commandId } : {}),
        }))
    )
      return err(ConflictError({ entity: 'project', id }));
    const row = db.orm
      .update(projects)
      .set({ name, updatedAt: options.fromConversation ? before.value.updatedAt : db.clock() })
      .where(eq(projects.id, id))
      .returning()
      .get();
    return found(row, 'project', id);
  });
}
