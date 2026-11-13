// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { Backend } from '../../backend/backend';
import { createImportSoundObserver, createSoundEventHandler, SOUND_EVENTS } from './sound-events';
import type { SoundPreference } from './sound-preference';
import type { InterfaceSounds } from './sound-runtime';

function retry(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, 1000);
    signal.addEventListener('abort', finish, { once: true });
    if (signal.aborted) finish();
  });
}

/** Reconnection seeds observations anew, so a recovered stream never turns history into a cue. */
export function observeSounds(backend: Backend, sounds: InterfaceSounds, preference: SoundPreference) {
  const controller = new AbortController();
  const { signal } = controller;
  async function events() {
    while (!signal.aborted) {
      try {
        const stream = await backend.events.subscribe({ types: [...SOUND_EVENTS] }, { signal });
        if (signal.aborted) return;
        const handle = createSoundEventHandler(sounds, preference);
        void preference.refresh();
        for await (const event of stream) {
          if (signal.aborted) return;
          if ((SOUND_EVENTS as readonly string[]).includes(event.type))
            handle(event as Parameters<typeof handle>[0]);
        }
      } catch {
        // Re-read the authoritative setting when the connection returns.
      }
      if (!signal.aborted) {
        preference.cancel();
        await retry(signal);
      }
    }
  }
  async function imports() {
    while (!signal.aborted) {
      try {
        const consume = createImportSoundObserver(sounds);
        const stream = await backend.imports.watch({}, { signal });
        for await (const snapshot of stream) {
          if (signal.aborted) return;
          consume(snapshot.sessions);
        }
      } catch {
        // Import status is optional feedback; it never blocks an import or startup.
      }
      if (!signal.aborted) await retry(signal);
    }
  }
  void events();
  void imports();
  return () => controller.abort();
}
