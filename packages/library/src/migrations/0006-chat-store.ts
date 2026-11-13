// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the chat backend needs (ConversationStore, ports/conversations.ts):
 *
 * - conversations: `archived_at` and `deleted_at`, so archiving and deleting
 *   are soft and can be undone.
 * - chat_cards: the latest payload of each card a conversation shows, by card
 *   id. Cards update in place (a plan ticking off steps), so messages refer to
 *   them by id instead of copying them.
 * - tool_runs: `side_effect`, which the history's tool events carry.
 */
import type { Migration } from './types';

const up = `
ALTER TABLE conversations ADD COLUMN archived_at INTEGER;
ALTER TABLE conversations ADD COLUMN deleted_at INTEGER;
CREATE INDEX conversations_recent_idx ON conversations(updated_at);

ALTER TABLE tool_runs ADD COLUMN side_effect TEXT
  CHECK (side_effect IS NULL OR side_effect IN ('read', 'write', 'destructive', 'external'));

CREATE TABLE chat_cards (
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  card_id TEXT NOT NULL CHECK (length(card_id) BETWEEN 1 AND 200),
  run_id TEXT,
  card TEXT NOT NULL CHECK (json_valid(card)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (conversation_id, card_id)
) STRICT;
`;

const down = `
DROP TABLE chat_cards;
ALTER TABLE tool_runs DROP COLUMN side_effect;
DROP INDEX conversations_recent_idx;
ALTER TABLE conversations DROP COLUMN deleted_at;
ALTER TABLE conversations DROP COLUMN archived_at;
`;

export const chatStore: Migration = { version: 6, name: 'chat_store', up, down };
