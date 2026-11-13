// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  newId,
  ok,
  type ChatService,
  type ConversationRecord,
  type EventOf,
  type Result,
} from '@taalcut/core';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useEffect, useMemo, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConversationUpdates } from '../src/chat/use-conversation-updates';

let receiveEvent: (event: EventOf<'library.changed'>) => void;
vi.mock('../src/backend/use-events', () => ({
  useBackendEvents: (_types: unknown, receive: typeof receiveEvent) => {
    receiveEvent = receive;
  },
}));
const id = newId<'Conversation'>();
const secondId = newId<'Conversation'>();
const record = (name = 'Airport'): ConversationRecord => ({
  conversation: { id, title: name, createdAt: 1, updatedAt: 2, projectId: null },
  history: [],
});
const changed = (conversationId = id) =>
  receiveEvent({
    type: 'library.changed',
    at: 2,
    payload: { entity: 'conversation', ids: [conversationId], projectId: null, change: 'updated' },
  });
function pending() {
  let resolve!: (result: Result<ConversationRecord>) => void;
  return {
    promise: new Promise<Result<ConversationRecord>>((done) => {
      resolve = done;
    }),
    resolve: (result: Result<ConversationRecord>) => resolve(result),
  };
}

describe('conversation invalidation receipts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('catches invalidations during initial loading after the authoritative snapshot becomes ready', async () => {
    const getConversation = vi.fn(async () => ok(record()));
    const refresh = vi.fn();
    const chat = { getConversation } as unknown as ChatService;
    const hook = renderHook(({ ready }) => useConversationUpdates(chat, id, ready, '0', refresh), {
      initialProps: { ready: false },
    });
    act(() => changed());
    expect(getConversation).not.toHaveBeenCalled();
    hook.rerender({ ready: true });
    await waitFor(() => expect(refresh).toHaveBeenCalledExactlyOnceWith(record()));
  });

  it('coalesces invalidation bursts and never applies replies out of order', async () => {
    const first = pending();
    const second = pending();
    const getConversation = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const refresh = vi.fn();
    renderHook(() =>
      useConversationUpdates({ getConversation } as unknown as ChatService, id, true, '0', refresh),
    );
    act(() => {
      changed();
      changed();
      changed();
    });
    expect(getConversation).toHaveBeenCalledOnce();
    await act(async () => first.resolve(ok(record('Earlier'))));
    expect(getConversation).toHaveBeenCalledTimes(2);
    await act(async () => second.resolve(ok(record('Latest'))));
    expect(refresh.mock.calls.map(([value]) => value.conversation.title)).toEqual(['Earlier', 'Latest']);
  });

  it('ignores a prior conversation response after navigation', async () => {
    const first = pending();
    const getConversation = vi.fn().mockReturnValue(first.promise);
    const chat = { getConversation } as unknown as ChatService;
    const refresh = vi.fn();
    const hook = renderHook(
      ({ conversationId, ready }) => useConversationUpdates(chat, conversationId, ready, '0', refresh),
      { initialProps: { conversationId: id, ready: true } },
    );
    act(() => changed());
    hook.rerender({ conversationId: secondId, ready: true });
    await act(async () => first.resolve(ok(record())));
    expect(refresh).not.toHaveBeenCalled();
  });

  it('invalidates an in-flight refresh on reload and catches events while that reload is pending', async () => {
    const first = pending();
    const getConversation = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue(ok(record('Reloaded')));
    const chat = { getConversation } as unknown as ChatService;
    const refresh = vi.fn();
    const hook = renderHook(({ ready, epoch }) => useConversationUpdates(chat, id, ready, epoch, refresh), {
      initialProps: { ready: true, epoch: '0' },
    });
    act(() => changed());
    hook.rerender({ ready: true, epoch: '1' });
    act(() => changed());
    hook.rerender({ ready: false, epoch: '1' });
    await act(async () => first.resolve(ok(record('Stale'))));
    expect(refresh).not.toHaveBeenCalled();
    hook.rerender({ ready: true, epoch: '1' });
    await waitFor(() => expect(refresh).toHaveBeenCalledExactlyOnceWith(record('Reloaded')));
  });

  it('keeps the current UI on a failed refresh and retries on the next invalidation', async () => {
    const getConversation = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: { code: 'offline' } })
      .mockResolvedValueOnce(ok(record()));
    const chat = { getConversation } as unknown as ChatService;
    const refresh = vi.fn();
    renderHook(() => useConversationUpdates(chat, id, true, '0', refresh));
    await act(async () => changed());
    expect(refresh).not.toHaveBeenCalled();
    await act(async () => changed());
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('ties readiness to load identity even when a fast reload batches its status changes', async () => {
    const getConversation = vi.fn(async () => ok(record()));
    const chat = { getConversation } as unknown as ChatService;
    const refresh = vi.fn();
    const hook = renderHook(
      ({ epoch }) => {
        const loadKey = useMemo(() => ({}), [epoch]);
        const [readyKey, setReadyKey] = useState<object | null>(null);
        useEffect(() => {
          void Promise.resolve().then(() => setReadyKey(loadKey));
        }, [loadKey]);
        useConversationUpdates(chat, id, readyKey === loadKey, loadKey, refresh);
      },
      { initialProps: { epoch: 0 } },
    );
    await act(async () => undefined);
    hook.rerender({ epoch: 1 });
    act(() => changed());
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  });
});
