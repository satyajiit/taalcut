// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { fromRpcError, type TaalcutError } from '@taalcut/core';

/**
 * Calls `onValue` with each value a `changed`-style stream yields (the current one first), and `onEnd` with the
 * cause when it fails (the thing was deleted, the process restarted, the port went), until the returned function is
 * called. Callers that tell "gone" from "broken" read the cause (`isGone`).
 */
export function followStream<T>(
  open: (signal: AbortSignal) => Promise<AsyncIterable<T>>,
  onValue: (value: T) => void,
  onEnd: (error: TaalcutError) => void,
): () => void {
  const controller = new AbortController();
  void (async () => {
    try {
      for await (const value of await open(controller.signal)) {
        if (controller.signal.aborted) return;
        onValue(value);
      }
    } catch (cause) {
      if (!controller.signal.aborted) onEnd(fromRpcError(cause));
    }
  })();
  return () => controller.abort();
}

/**
 * Whether an error says the thing is gone (deleted, or never there): core's `core.not_found` and every domain's
 * `<package>.not_found` (timeline.not_found ends a timeline's watch). Anything else is a failure for now: a card keeps
 * what it showed and offers Try again instead of saying "This was deleted."
 */
export function isGone(error: TaalcutError): boolean {
  return error.code === 'core.not_found' || error.code.endsWith('.not_found');
}
