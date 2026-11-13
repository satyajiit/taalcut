// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Handing words to a chat that isn't open yet: a message to send as soon as
 * a new conversation opens (from the new-chat page and its starters), and a
 * draft to put in the composer (from Templates' paste-a-link field). The
 * draft survives a reload of the tab (sessionStorage); the message doesn't
 * need to (it is sent the moment the conversation opens).
 */
import type { ReasoningLevel, ChatStart, ConversationId } from '@taalcut/core';

/** A draft for the next chat's composer, set by pages that start a chat with words in it. */
export const COMPOSER_DRAFT_KEY = 'taalcut.composer.draft';

/** A first message, and the thinking level picked for it on the new-chat page, if any. */
export interface MessageToSend {
  readonly text: string;
  readonly reasoning?: ReasoningLevel;
  /** An opening choice made on the new-chat page: the flow it starts (P2-M13). */
  readonly start?: ChatStart;
}

export interface HandoffStore {
  sendWhenOpen(
    conversationId: ConversationId,
    text: string,
    reasoning?: ReasoningLevel,
    start?: ChatStart,
  ): void;
  takeMessageToSend(conversationId: ConversationId): MessageToSend | undefined;
  reset(): void;
}

export function createHandoffStore(): HandoffStore {
  const toSend = new Map<ConversationId, MessageToSend>();
  return {
    sendWhenOpen(conversationId, text, reasoning, start) {
      toSend.set(conversationId, {
        text,
        ...(reasoning ? { reasoning } : {}),
        ...(start ? { start } : {}),
      });
    },
    takeMessageToSend(conversationId) {
      const message = toSend.get(conversationId);
      toSend.delete(conversationId);
      return message;
    },
    reset() {
      toSend.clear();
    },
  };
}

export const handoffStore: HandoffStore = createHandoffStore();

/** Sends `text` in `conversationId` once that conversation is open and ready. */
export function sendWhenOpen(
  conversationId: ConversationId,
  text: string,
  reasoning?: ReasoningLevel,
  start?: ChatStart,
): void {
  handoffStore.sendWhenOpen(conversationId, text, reasoning, start);
}

/** The message waiting for this conversation, if any. Taking it clears it. */
export function takeMessageToSend(conversationId: ConversationId): MessageToSend | undefined {
  return handoffStore.takeMessageToSend(conversationId);
}

/**
 * The composer draft another page left, if any. Read it while rendering and
 * clear it once the composer has shown it (rendering may run twice).
 */
export function peekComposerDraft(): string | undefined {
  try {
    return sessionStorage.getItem(COMPOSER_DRAFT_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

/** The draft is in the composer now: it won't come back on the next chat. */
export function clearComposerDraft(): void {
  try {
    sessionStorage.removeItem(COMPOSER_DRAFT_KEY);
  } catch {
    // Storage blocked: there was nothing to clear.
  }
}
