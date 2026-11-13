// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { PROJECT_COMMANDS, projectCommandPayloads, type CommandId, type ConversationId } from '@taalcut/core';
import { and, asc, desc, eq, ne } from 'drizzle-orm';
import type { LibraryDatabase } from '../db/database';
import { commands } from '../schema/audit';
import { conversations, type projects } from '../schema/chat';

/** Called inside the rename transaction: a delayed title must never undo a person's naming choice. */
export function canNameProjectFromConversation(
  db: LibraryDatabase,
  project: typeof projects.$inferSelect,
  input: { name: string; conversationId: ConversationId; commandId?: CommandId },
): boolean {
  if (project.archivedAt !== null) return false;
  const created = db.orm
    .select()
    .from(commands)
    .where(eq(commands.id, project.id as string as CommandId))
    .get();
  if (
    created?.name !== PROJECT_COMMANDS.create ||
    created.source !== 'agent' ||
    created.actor !== 'agent:flow'
  )
    return false;
  const initial = projectCommandPayloads[PROJECT_COMMANDS.create].safeParse(created.payload);
  if (!initial.success) return false;

  // A deleted first chat still owns the project; a later chat cannot silently take over its name.
  const owner = db.orm
    .select()
    .from(conversations)
    .where(eq(conversations.projectId, project.id))
    .orderBy(asc(conversations.createdAt), asc(conversations.id))
    .limit(1)
    .get();
  if (owner?.id !== input.conversationId || owner.deletedAt !== null || owner.title !== input.name)
    return false;

  const renames = db.orm
    .select()
    .from(commands)
    .where(
      and(
        eq(commands.projectId, project.id),
        eq(commands.name, PROJECT_COMMANDS.rename),
        input.commandId ? ne(commands.id, input.commandId) : undefined,
      ),
    )
    .orderBy(desc(commands.seq))
    .all();
  let latest: string | undefined;
  for (const renamed of renames) {
    const payload = projectCommandPayloads[PROJECT_COMMANDS.rename].safeParse(renamed.payload);
    if (
      renamed.source !== 'agent' ||
      renamed.actor !== 'agent:project-title' ||
      renamed.status === 'undone' ||
      !payload.success ||
      payload.data.fromConversation !== owner.id
    )
      return false;
    latest ??= payload.data.name;
  }
  return project.name === initial.data.name || project.name === latest;
}
