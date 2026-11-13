// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createFileRoute, Outlet } from '@tanstack/react-router';
import type { ConversationId } from '@taalcut/core';
import { ConversationProvider, useOpenConversation } from '../../../../chat/conversation-context';
import { ConversationPending } from '../../../../chat/conversation-pending';
import { useNameCrumb } from '../../../../shell/nav/crumb-words';
import { routeId } from '../../../../shell/route-id';

/**
 * One chat and the pages under it (UX4): the transcript, and its approval's review page. They share the open
 * conversation, so the run keeps streaming while you review and the transcript is as you left it when you come back.
 */
export const Route = createFileRoute('/_shell/chat/$conversationId')({
  params: {
    parse: ({ conversationId }) => ({ conversationId: routeId<'Conversation'>(conversationId) }),
    stringify: ({ conversationId }) => ({ conversationId }),
  },
  component: ConversationLayout,
  // Its chunk is small, but the chat's bones show while it comes, as before (skeleton.spec.ts).
  pendingComponent: ConversationPending,
  pendingMs: 0,
  pendingMinMs: 0,
  codeSplitGroupings: [['component'], ['errorComponent'], ['notFoundComponent']],
});

function ConversationLayout() {
  const { conversationId } = Route.useParams();
  // A new id is a new conversation: remount, so nothing carries over.
  return (
    <ConversationProvider key={conversationId} conversationId={conversationId}>
      <ConversationCrumb conversationId={conversationId} />
      <Outlet />
    </ConversationProvider>
  );
}

/** The chat's name for the pages under it: its review page reads "Agent › <the chat's name> › Review". */
function ConversationCrumb({ conversationId }: { conversationId: ConversationId }) {
  const title = useOpenConversation().state.conversation?.title;
  useNameCrumb(`/chat/${conversationId}`, title ? { text: title, own: true } : null);
  return null;
}
