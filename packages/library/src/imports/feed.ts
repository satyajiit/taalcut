// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { ImportSession, ImportSessionId } from '@taalcut/core';

/** Coalesce ordinary progress, but never delay a terminal state. Each subscriber owns one bounded slot. */
export function createImportFeed(snapshot: () => ImportSession[]) {
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let last = 0;
  const publish = () => {
    last = Date.now();
    for (const changed of listeners) changed();
  };
  return {
    changed(immediate = false) {
      if (immediate || Date.now() - last >= 250) {
        clearTimeout(timer);
        timer = undefined;
        publish();
      } else if (!timer)
        timer = setTimeout(
          () => {
            timer = undefined;
            publish();
          },
          250 - (Date.now() - last),
        );
    },
    async *watch(sessionId: ImportSessionId | undefined, signal: AbortSignal) {
      let dirty = true;
      let wake: (() => void) | undefined;
      const changed = () => {
        dirty = true;
        wake?.();
      };
      listeners.add(changed);
      signal.addEventListener('abort', changed, { once: true });
      try {
        while (!signal.aborted) {
          if (!dirty)
            await new Promise<void>((resolve) => {
              wake = resolve;
            });
          wake = undefined;
          if (signal.aborted) return;
          dirty = false;
          yield { sessions: snapshot().filter((value) => !sessionId || value.id === sessionId) };
        }
      } finally {
        listeners.delete(changed);
        signal.removeEventListener('abort', changed);
      }
    },
    close() {
      clearTimeout(timer);
      timer = undefined;
    },
  };
}
