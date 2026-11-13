// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { msg } from '@lingui/core/macro';
import { createFileRoute } from '@tanstack/react-router';
import { ConversationPending } from '../../../../chat/conversation-pending';
import { ConversationView } from '../../../../chat/conversation-view';

export const Route = createFileRoute('/_shell/chat/$conversationId/')({
  // A crumb for the pages under a chat: its review page reads "Agent › <the chat's name> › Review" once the chat has
  // opened (its layout names it, shell/nav/crumb-words.ts), "Agent › Chat › Review" until then.
  staticData: { crumb: msg`Chat` },
  component: Conversation,
  // The transcript's code is ~60 chunks (every card type), slow to arrive on a busy Mac, and its own skeleton
  // can only mount after them. So the same skeleton is the route's pending view, kept out of the split chunks
  // (no 'pendingComponent' group) and shown at once.
  pendingComponent: ConversationPending,
  pendingMs: 0,
  pendingMinMs: 0,
  codeSplitGroupings: [['component'], ['errorComponent'], ['notFoundComponent']],
});

function Conversation() {
  const { conversationId } = Route.useParams();
  return <ConversationView conversationId={conversationId} />;
}
