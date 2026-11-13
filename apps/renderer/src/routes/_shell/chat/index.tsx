// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · page: chat home · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md v0.3
 * The start surface (A10): Kaatu and the heading, the four opening choices (P2-M13), then the composer. A
 * choice or what you type becomes a new chat's first message. */

import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import { newId, ok, type ReasoningLevel, type ChatStart } from '@taalcut/core';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useCallback, useMemo, useRef } from 'react';
import { useAppCardActions } from '../../../chat/card-actions';
import { ChatComposer } from '../../../chat/chat-composer';
import { ChatStartIntro } from '../../../chat/chat-start';
import { sendWhenOpen } from '../../../chat/handoff';
import { NewChatChoices } from '../../../chat/new-chat-choices';
import { Page } from '../../../shell/page';

export const Route = createFileRoute('/_shell/chat/')({
  // A crumb: a chat reads "Agent › its name", Agent a link to a new chat here (shell/nav).
  staticData: { crumb: msg`Agent` },
  component: ChatHome,
});

function ChatHome() {
  const { t } = useLingui();
  const navigate = useNavigate();
  const app = useAppCardActions();
  const bar = useRef<HTMLDivElement>(null);
  // The conversation is created by its first message, in the chat it opens (with the level picked here).
  const start = useCallback(
    (text: string, reasoning?: ReasoningLevel, flow?: ChatStart) => {
      const conversationId = newId<'Conversation'>();
      sendWhenOpen(conversationId, text, reasoning, flow);
      void navigate({ to: '/chat/$conversationId', params: { conversationId } });
    },
    [navigate],
  );
  const actions = useMemo(
    () => ({
      ...app,
      startFlow: async (flow: ChatStart, text: string) => {
        start(text, undefined, flow);
        return ok(undefined);
      },
      focusComposer: () => bar.current?.querySelector('textarea')?.focus(),
    }),
    [app, start],
  );
  return (
    // The start surface sits high and still, on the reading column.
    <Page title={t`Agent`} width="reading" className="flex-1 gap-6 pt-[max(2.5rem,14vh)]">
      <ChatStartIntro />
      <NewChatChoices actions={actions} onCreateShort={start} />
      <div ref={bar}>
        <ChatComposer busy={false} onSend={start} onStop={() => undefined} />
      </div>
    </Page>
  );
}
