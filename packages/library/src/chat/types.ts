// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The chat read model, shaped after the renderer's chat client
 * (apps/renderer/src/chat/client.ts): a conversation summary, and a record
 * whose `history` is the events the transcript replays. The stored parts
 * (messages, cards, tool runs, runs) come with it for the backend and the
 * trace viewer. Core owns the types (its ConversationStore port); the
 * library's names for them are kept here.
 */
export {
  CHAT_ROLES,
  type CardPayload,
  type ChatCard,
  type ChatHistoryEvent,
  type ChatMessage,
  type ChatRole,
  type ChatToolRun,
  type ConversationHistory,
  type MessagePart,
  type MessagePartInput,
  type StoredConversation as ConversationRecord,
  type StoredConversationSummary as ConversationSummary,
  type UserMessageEvent,
} from '@taalcut/core';
