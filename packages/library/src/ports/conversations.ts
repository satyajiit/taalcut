// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Core's ConversationStore port (createLibraryPorts: `conversations`) over
 * the chat repository. Its reads match the renderer's chat client
 * (apps/renderer/src/chat/client.ts): `list()` for `listConversations()`,
 * and `get(id)` for `getConversation(id)`, whose `history` replays through
 * the transcript reducer.
 */
import type { ConversationStore } from '@taalcut/core';
import { toChatHistory } from '../chat/history';
import type { LibraryDatabase } from '../db/database';
import { createChatRepository } from '../repositories/chat';

/** The port and its token now live in core; re-exported for existing imports. */
export { ConversationStoreToken, type ConversationStore } from '@taalcut/core';

export function createConversationStore(db: LibraryDatabase): ConversationStore {
  const repo = createChatRepository(db);
  return {
    create: async (input) => repo.create(input),
    list: async (options) => ({ ok: true, value: repo.list(options) }),
    get: async (id) => {
      const history = repo.history(id);
      return history.ok
        ? { ok: true, value: { ...history.value, history: toChatHistory(history.value) } }
        : history;
    },
    appendMessage: async (input) => repo.appendMessage(input),
    putCard: async (input) => repo.putCard(input),
    rename: async (id, title, options) => repo.rename(id, title, options),
    setProject: async (id, projectId) => repo.setProject(id, projectId),
    archive: async (id) => repo.archive(id),
    unarchive: async (id) => repo.unarchive(id),
    delete: async (id) => repo.remove(id),
    restore: async (id) => repo.restore(id),
    purge: async (id) => repo.purge(id),
    linkRun: async (conversationId, runId) => repo.linkRun(conversationId, runId),
  };
}
