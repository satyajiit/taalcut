// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * HFW1-UI: words for the project's chat to send from outside it, with chips: the inspector's Try again on a designed
 * graphic ("design this graphic another way", the graphic as a chip). The page opens the dock on Chat; the chat
 * sends the words once it has loaded and no run is going (a request made meanwhile waits).
 */
import type { SelectionChip } from '@taalcut/core';
import { useEffect, useRef } from 'react';
import type { MessageExtras } from '../../../chat/use-conversation';
import { createTickStore, useClaim, useLatest } from '../comments/comment-requests';

export interface ChatSend {
  readonly text: string;
  readonly selections: readonly SelectionChip[];
}

export const chatSendRequests = createTickStore<ChatSend>();

/** Sends `text` with `selections` in the project's docked chat. */
export const sendInChat = (request: ChatSend): void => chatSendRequests.push(request);

/** The chat side: sends each request once it is ready. */
export function useChatSends(
  send: (text: string, reasoning?: undefined, extras?: MessageExtras) => void,
  ready: boolean,
): void {
  useClaim(chatSendRequests, ({ text, selections }) => send(text, undefined, { selections }), ready);
}

/** The page's side: a new request shows the chat. */
export function useChatSendDock(open: (panel: 'chat') => void): void {
  const sent = useLatest(chatSendRequests)?.tick ?? 0;
  const seen = useRef(sent);
  useEffect(() => {
    if (sent > seen.current) open('chat');
    seen.current = sent;
  }, [sent, open]);
}
