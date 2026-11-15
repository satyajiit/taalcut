// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * HFW1-UI: words for the project's chat to send from outside it, with chips: the inspector's Try again on a designed
 * graphic ("design this graphic another way", the graphic as a chip). The page opens the dock on Chat; the chat
 * sends the words once it has loaded and no run is going (a request made meanwhile waits). CVR1: the cover panel's
 * "Generate with AI" sends its words with the cover it asks for, and reads how the chat stands (`useDockedChat`):
 * its request still waiting to be taken, or a run going.
 */
import type { CoverRequest, PostCaptionRequest, SelectionChip } from '@taalcut/core';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { MessageExtras } from '../../../chat/use-conversation';
import { createTickStore, useClaim, useLatest } from '../comments/comment-requests';

export interface ChatSend {
  readonly text: string;
  readonly selections: readonly SelectionChip[];
  /** CVR1: the cover the words ask for, at the aspect picked in the cover panel. */
  readonly cover?: CoverRequest;
  /** CAP1: the post caption the words ask for, for the platform picked in the caption panel. */
  readonly postCaption?: PostCaptionRequest;
}

export const chatSendRequests = createTickStore<ChatSend>();
/** CVR1: whether the docked chat has a run going, as it last said (false with no docked chat on screen). */
const chatWorking = createTickStore<boolean>();

/** Sends `text` with `selections` in the project's docked chat. Answers the request's tick (`DockedChat.waiting`). */
export function sendInChat(request: ChatSend): number {
  chatSendRequests.push(request);
  return chatSendRequests.waiting();
}

/** The chat side: sends each request once it is ready, and says whether a run is going (`busy`). */
export function useChatSends(
  send: (text: string, reasoning?: undefined, extras?: MessageExtras) => void,
  ready: boolean,
  busy = false,
): void {
  useClaim(
    chatSendRequests,
    ({ text, selections, cover, postCaption }) =>
      send(text, undefined, {
        selections,
        ...(cover ? { cover } : {}),
        ...(postCaption ? { postCaption } : {}), // CAP1
      }),
    ready,
  );
  useEffect(() => {
    chatWorking.push(busy);
    return () => chatWorking.push(false);
  }, [busy]);
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

export interface DockedChat {
  /** The tick of the request the chat has yet to take (it is opening, or working); 0 when none waits. */
  readonly waiting: number;
  /** A run is going in the docked chat. */
  readonly busy: boolean;
}

/** CVR1: how the docked chat stands, for a control that asks through it. */
export function useDockedChat(): DockedChat {
  // The store tells its listeners when a request is claimed too, so this turns 0 as the chat takes it.
  const waiting = useSyncExternalStore(chatSendRequests.subscribe, chatSendRequests.waiting);
  return { waiting, busy: useLatest(chatWorking)?.value ?? false };
}
