// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { ConversationId, RunId } from '@taalcut/core';
import { createContext, useCallback, useContext, type ReactNode } from 'react';
import { approvalIdsOf } from './approvals';
import type { TranscriptItem } from './transcript';
import { useConversation, type ConversationState } from './use-conversation';

interface OpenConversation {
  readonly conversationId: ConversationId;
  readonly state: ConversationState;
}

const Conversation = createContext<OpenConversation | null>(null);

/**
 * One conversation for its pages (UX4): the transcript and the review page of its approval share it, so going to the
 * review and back keeps the run streaming, the transcript as it was and the answer in one place. The route keys it by
 * id, so another chat starts afresh.
 */
export function ConversationProvider({
  conversationId,
  children,
}: {
  conversationId: ConversationId;
  children: ReactNode;
}) {
  const state = useConversation(conversationId);
  return <Conversation.Provider value={{ conversationId, state }}>{children}</Conversation.Provider>;
}

/** The open conversation; only inside its route. */
export function useOpenConversation(): OpenConversation {
  const open = useContext(Conversation);
  if (!open) throw new Error('useOpenConversation outside a conversation route');
  return open;
}

/** The run an approval belongs to, from the transcript, to answer it. */
export function useRunIdForApproval(items: readonly TranscriptItem[]) {
  return useCallback(
    (approvalId: string) => {
      for (const item of items) {
        if (item.kind !== 'card') continue;
        const { card } = item;
        if ('runId' in card && card.runId && approvalIdsOf(card).includes(approvalId))
          return card.runId as RunId;
      }
      return undefined;
    },
    [items],
  );
}
