// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { ConversationId, RunId } from '@taalcut/core';
import type { ChatTitlingDeps } from './chat-titles';
import { TERMINAL_EVENTS, type AgentEvent } from './events';
import type { ConversationStore } from './ports';

/** A finished run's stream is closed. Tell its open conversation to fetch the saved-file receipt. */
export function createCoverUpdates(
  conversations: ConversationStore,
  ownerOf: (runId: RunId) => Promise<ConversationId | undefined>,
  onChanged: ChatTitlingDeps['onChanged'],
) {
  const finished = new Set<RunId>();
  return (event: AgentEvent): void => {
    if (TERMINAL_EVENTS.includes(event.type)) finished.add(event.runId);
    if (
      !onChanged ||
      event.type !== 'card.sent' ||
      event.payload.card.type !== 'toolRun' ||
      !event.payload.card.savedCover ||
      !finished.has(event.runId)
    )
      return;
    void ownerOf(event.runId).then(async (id) => {
      if (!id) return;
      const stored = await conversations.get(id);
      if (stored.ok) onChanged(stored.value.conversation);
    });
  };
}
