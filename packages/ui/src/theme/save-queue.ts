// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The theme engine's saves (IX3-F7, F2). One is in flight at a time, and a choice made while one is saving
 * replaces any still waiting, so an older save never lands after a newer one. The engine shows a choice at once.
 * When the last save failed, or the store announced a change while ours were saving (our own echoes, or another
 * window), the queue asks the store what it really keeps once nothing is waiting, and the engine shows that.
 */
import type { ThemePreference } from '@taalcut/core';
import { isThemePreference } from './preferences';

/** The two calls of the engine's ThemeStore that the queue makes. */
export interface SavingStore {
  load(): ThemePreference | Promise<ThemePreference>;
  save(preference: ThemePreference): void | Promise<void>;
}

export interface SaveQueue {
  /** Settles once this choice and any made after it are saved, or the store's own preference is back on screen. */
  save(preference: ThemePreference): Promise<void>;
  /** The store's preference at start. */
  loaded(preference: ThemePreference): void;
  /**
   * A change the store announced. False while our saves run: the store is asked once they are done, as the
   * announcement may be an echo of an older choice of ours.
   */
  elsewhere(preference: ThemePreference): boolean;
}

export function createSaveQueue(
  store: SavingStore,
  engine: {
    /** Shows the store's preference (a no-op when it is the one showing). */
    readonly restore: (kept: ThemePreference) => void;
    readonly log?: (message: string, cause?: unknown) => void;
  },
): SaveQueue {
  const log = engine.log ?? ((message: string, cause?: unknown) => console.error(message, cause));
  let kept: ThemePreference = 'system';
  let waiting: ThemePreference | null = null;
  let heard = false;
  let running: Promise<void> | null = null;

  async function persist(preference: ThemePreference): Promise<boolean> {
    try {
      await store.save(preference);
      kept = preference;
      return true;
    } catch (cause) {
      // eslint-disable-next-line lingui/no-unlocalized-strings -- a developer log line, never shown
      log(`[theme] ${preference} was not saved; showing what the store keeps`, cause);
      return false;
    }
  }

  async function stored(): Promise<ThemePreference> {
    try {
      const value = await store.load();
      if (isThemePreference(value)) kept = value;
    } catch (cause) {
      // eslint-disable-next-line lingui/no-unlocalized-strings -- a developer log line, never shown
      log(`[theme] could not read the saved preference; showing ${kept}, the last one saved`, cause);
    }
    return kept;
  }

  async function drain(): Promise<void> {
    let failed = false;
    for (;;) {
      while (waiting !== null) {
        const next = waiting;
        waiting = null;
        failed = !(await persist(next));
      }
      if (!failed && !heard) return;
      failed = false;
      heard = false;
      const truth = await stored();
      // A newer choice made meanwhile goes on to be saved; it is what shows.
      if (waiting === null) return engine.restore(truth);
    }
  }

  return {
    save(preference) {
      waiting = preference;
      running ??= drain().finally(() => {
        running = null;
      });
      return running;
    },
    loaded(preference) {
      kept = preference;
    },
    elsewhere(preference) {
      if (running !== null) {
        heard = true;
        return false;
      }
      kept = preference;
      return true;
    },
  };
}
