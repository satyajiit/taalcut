// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { ChatService, ConversationId, ConversationRecord } from '@taalcut/core';
import { useEffect, useRef } from 'react';
import { useBackendEvents } from '../backend/use-events';

interface UpdateScope {
  alive: boolean;
  ready: boolean;
  dirty: boolean;
  refreshing: boolean;
}

/** Refresh summaries and durable receipts without restarting the stream or replaying its words. */
export function useConversationUpdates(
  chat: ChatService,
  id: ConversationId,
  ready: boolean,
  epoch: unknown,
  onRefresh: (record: ConversationRecord) => void,
): void {
  const scope = useRef<UpdateScope | null>(null);
  const receive = useRef(onRefresh);
  useEffect(() => {
    receive.current = onRefresh;
  });
  useEffect(() => {
    const current: UpdateScope = { alive: true, ready: false, dirty: false, refreshing: false };
    scope.current = current;
    return () => {
      current.alive = false;
    };
  }, [chat, id, epoch]);

  const refresh = async (current: UpdateScope) => {
    if (current.refreshing) return;
    current.refreshing = true;
    try {
      while (current.alive && current.ready && current.dirty) {
        current.dirty = false;
        const result = await chat.getConversation(id);
        if (!current.alive) return;
        if (!current.ready) {
          current.dirty = true;
          return;
        }
        if (result.ok) receive.current(result.value);
      }
    } finally {
      current.refreshing = false;
    }
  };

  useEffect(() => {
    const current = scope.current;
    if (!current) return;
    current.ready = ready;
    if (ready && current.dirty) void refresh(current);
    // Readiness belongs to the completed load key, not a status React may batch through in one render.
  }, [ready]);

  useBackendEvents(['library.changed'], (event) => {
    if (event.payload.entity !== 'conversation' || !event.payload.ids.includes(id)) return;
    const current = scope.current;
    if (!current) return;
    current.dirty = true;
    if (current.ready) void refresh(current);
  });
}
