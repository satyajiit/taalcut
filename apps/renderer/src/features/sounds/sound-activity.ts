// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

export interface SoundActivity {
  acquire(reason: 'playback' | 'recording'): () => void;
  isBusy(): boolean;
  subscribe(listener: () => void): () => void;
}

const noop = () => undefined;

/** Isolated views do not need to construct the application's sound service. */
export const NO_SOUND_ACTIVITY: SoundActivity = {
  acquire: () => noop,
  isBusy: () => false,
  subscribe: () => noop,
};

export function createSoundActivity(): SoundActivity {
  const active = new Set<symbol>();
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  return {
    acquire(reason) {
      const token = Symbol(reason);
      const wasBusy = active.size > 0;
      active.add(token);
      if (!wasBusy) notify();
      return () => {
        if (active.delete(token) && active.size === 0) notify();
      };
    },
    isBusy: () => active.size > 0,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
