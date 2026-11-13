// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  callRpc,
  fromRpcError,
  SETTINGS_COMMANDS,
  type InterfaceSoundsState,
  type TaalcutError,
} from '@taalcut/core';
import type { Backend } from '../../backend/backend';

export const SOUNDS_STORAGE_KEY = 'taalcut.sounds';

export interface SoundPreferenceSnapshot {
  readonly enabled: boolean;
  readonly ready: boolean;
  readonly pending: boolean;
  readonly error: TaalcutError | null;
}

export interface SoundPreference {
  getSnapshot(): SoundPreferenceSnapshot;
  subscribe(listener: () => void): () => void;
  refresh(): Promise<void>;
  changed(): void;
  setEnabled(enabled: boolean): Promise<boolean>;
  cancel(): void;
}

/** The legacy key is consulted only until the command-backed preference has been initialized. */
export function createSoundPreference(
  backend: Pick<Backend, 'interfaceSounds' | 'commands'>,
  storage: () => Pick<Storage, 'getItem' | 'removeItem'>,
): SoundPreference {
  let snapshot: SoundPreferenceSnapshot = { enabled: true, ready: false, pending: false, error: null };
  const listeners = new Set<() => void>();
  let epoch = 0;
  let changes = 0;
  let writes = 0;
  let refreshQueued = false;

  const publish = (next: SoundPreferenceSnapshot) => {
    snapshot = next;
    for (const listener of listeners) listener();
  };
  const waiting = (enabled = snapshot.enabled, pending = false) =>
    publish({ enabled, ready: false, pending, error: null });
  const failed = (cause: unknown) =>
    publish({ ...snapshot, ready: false, pending: false, error: fromRpcError(cause) });

  async function read(current: number): Promise<InterfaceSoundsState | null> {
    let seen: number;
    let state: InterfaceSoundsState;
    do {
      seen = changes;
      state = await backend.interfaceSounds.state();
      if (current !== epoch) return null;
      if (!state.initialized) {
        const enabled = storage().getItem(SOUNDS_STORAGE_KEY) !== 'off';
        await backend.commands.dispatch({
          name: SETTINGS_COMMANDS.initializeInterfaceSounds,
          payload: { enabled },
          source: 'ui',
        });
        if (current !== epoch) return null;
        state = await backend.interfaceSounds.state();
      }
    } while (current === epoch && seen !== changes);
    if (current !== epoch) return null;
    // A failure to remove the old key cannot override an authoritative saved preference.
    try {
      storage().removeItem(SOUNDS_STORAGE_KEY);
    } catch {
      // Storage may be blocked; initialization has already been persisted by the app.
    }
    return state;
  }

  async function refresh(): Promise<void> {
    if (writes > 0) {
      refreshQueued = true;
      return;
    }
    const current = ++epoch;
    waiting();
    const result = await callRpc(read(current));
    if (current !== epoch) return;
    if (!result.ok) failed(result.error);
    else if (result.value)
      publish({ enabled: result.value.enabled, ready: true, pending: false, error: null });
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    refresh,
    changed() {
      changes += 1;
      // A write reads the authoritative value after its acknowledgement, including its own event.
      if (writes === 0) void refresh();
    },
    async setEnabled(enabled) {
      const current = ++epoch;
      writes += 1;
      waiting(enabled, true);
      const result = await callRpc(
        backend.commands.dispatch({
          name: SETTINGS_COMMANDS.setInterfaceSounds,
          payload: { enabled },
          source: 'ui',
        }),
      );
      try {
        if (current !== epoch) return false;
        if (!result.ok) {
          failed(result.error);
          return false;
        }
        const saved = await callRpc(read(current));
        if (current !== epoch) return false;
        if (!saved.ok) {
          failed(saved.error);
          return false;
        }
        if (!saved.value) return false;
        publish({ enabled: saved.value.enabled, ready: true, pending: false, error: null });
        return saved.value.enabled === enabled;
      } finally {
        writes -= 1;
        if (writes === 0 && refreshQueued) {
          refreshQueued = false;
          void refresh();
        }
      }
    },
    cancel() {
      epoch += 1;
      refreshQueued = false;
      waiting();
    },
  };
}
