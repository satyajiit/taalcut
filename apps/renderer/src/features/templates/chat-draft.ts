// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Templates' ways into a chat: a reel's link or a built-in format's sentence goes into a new chat's composer as a
 * draft, unsent, so the person sees what Taalcut will be asked and can change it first.
 */
import { newId } from '@taalcut/core';
import type { useNavigate } from '@tanstack/react-router';
import { COMPOSER_DRAFT_KEY } from '../../chat/handoff';

export function openChatWithDraft(navigate: ReturnType<typeof useNavigate>, draft: string): void {
  try {
    sessionStorage.setItem(COMPOSER_DRAFT_KEY, draft);
  } catch {
    // Storage blocked: the chat still opens; the words just aren't carried over.
  }
  void navigate({ to: '/chat/$conversationId', params: { conversationId: newId<'Conversation'>() } });
}
