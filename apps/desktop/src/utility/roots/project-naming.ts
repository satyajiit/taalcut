// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  CommandBusToken,
  PROJECT_COMMANDS,
  type Container,
  type ConversationId,
  type ProjectId,
} from '@taalcut/core';
import { cleanTitle, isManagedTitle } from '@taalcut/agent';
import { LibraryDatabaseToken } from '../../shared/tokens';

const FLOW_PROJECT = `JOIN commands created ON created.id = p.id
  AND created.name = 'project.create' AND created.source = 'agent'
  AND created.actor = 'agent:flow' AND created.status != 'undone'`;

function firstMessage(content: unknown): string {
  const parts: unknown = JSON.parse(String(content ?? '[]'));
  if (!Array.isArray(parts)) return '';
  return parts
    .flatMap((part: unknown) => {
      if (!part || typeof part !== 'object') return [];
      const text = part as { type?: unknown; text?: unknown };
      return text.type === 'text' && typeof text.text === 'string' ? [text.text] : [];
    })
    .join('');
}

/** Reuse the title already generated for this chat; naming never starts an extra model call. */
export async function syncConversationProjectName(
  container: Container,
  conversationId: ConversationId,
  generatedTitle?: string,
): Promise<void> {
  if (!container.has(LibraryDatabaseToken) || !container.has(CommandBusToken)) return;
  try {
    const db = container.resolve(LibraryDatabaseToken);
    const row = db.driver
      .prepare(
        `SELECT p.id, p.name, c.title,
          (SELECT m.content FROM messages m WHERE m.conversation_id = c.id AND m.role = 'user'
            ORDER BY m.created_at, m.id LIMIT 1) AS first_message
         FROM conversations c JOIN projects p ON p.id = c.project_id ${FLOW_PROJECT}
         WHERE c.id = ? AND c.deleted_at IS NULL AND p.archived_at IS NULL`,
      )
      .get(conversationId);
    if (!row || typeof row.title !== 'string') return;
    const title = row.title;
    if (title === row.name || cleanTitle(title) !== title || /(?:https?|file):\/\/|www\./iu.test(title))
      return;
    if (
      generatedTitle !== undefined
        ? title !== generatedTitle
        : isManagedTitle(title, firstMessage(row.first_message))
    )
      return;
    const result = await container.resolve(CommandBusToken).dispatch(
      PROJECT_COMMANDS.rename,
      {
        projectId: String(row.id) as ProjectId,
        name: title,
        expectedName: String(row.name),
        fromConversation: conversationId,
      },
      { source: 'agent', actor: 'agent:project-title' },
    );
    // A manual rename, an undo, or a newer chat title wins over this background suggestion.
    if (!result.ok && result.error.code !== 'core.conflict')
      console.warn(`[project-naming] Could not update project title: ${result.error.code}`);
  } catch {
    console.warn('[project-naming] Could not update project title.');
  }
}

/** Catch up projects created before chat titles were connected to project names. */
export async function repairFlowProjectNames(container: Container): Promise<void> {
  if (!container.has(LibraryDatabaseToken) || !container.has(CommandBusToken)) return;
  const db = container.resolve(LibraryDatabaseToken);
  const rows = db.driver
    .prepare(
      `SELECT c.id FROM projects p ${FLOW_PROJECT}
       JOIN conversations c ON c.id = (
         SELECT owner.id FROM conversations owner WHERE owner.project_id = p.id
         ORDER BY owner.created_at, owner.id LIMIT 1)
       WHERE p.archived_at IS NULL AND c.deleted_at IS NULL AND c.title IS NOT NULL AND p.name != c.title`,
    )
    .all();
  for (const row of rows) await syncConversationProjectName(container, String(row.id) as ConversationId);
}
