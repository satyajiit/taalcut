// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { callRpc, type EventOf, type EventType } from '@taalcut/core';
import { useEffect, useRef } from 'react';
import { useBackend } from './backend';

/**
 * Calls `onEvent` for each event of these types the backend sends the page
 * (main's bus in Electron, the fake's in a browser), from mount until
 * unmount. A subscription that ends (the page or main going away) is simply
 * over; `onEvent` may change between renders without resubscribing.
 */
export function useBackendEvents<T extends EventType>(
  types: readonly T[],
  onEvent: (event: EventOf<T>) => void,
): void {
  const backend = useBackend();
  const handler = useRef(onEvent);
  useEffect(() => {
    handler.current = onEvent;
  });
  const key = types.join(' ');

  useEffect(() => {
    const wanted = key.split(' ') as T[];
    const controller = new AbortController();
    void (async () => {
      const stream = await callRpc(
        backend.events.subscribe({ types: wanted }, { signal: controller.signal }),
      );
      if (!stream.ok) return;
      try {
        for await (const event of stream.value) {
          if ((wanted as readonly string[]).includes(event.type)) handler.current(event as EventOf<T>);
        }
      } catch {
        // The subscription ended: this page is going away, or main is.
      }
    })();
    return () => controller.abort();
  }, [backend, key]);
}
