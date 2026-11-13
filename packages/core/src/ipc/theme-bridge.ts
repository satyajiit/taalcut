// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The theme as the renderer's theme engine wants it (@taalcut/ui's
 * electronStore): preference in, preference out, and changes made elsewhere.
 * themeBridgeOverRpc builds it on the theme contract, so the renderer needs
 * no theme-specific preload API.
 */
import type { ThemePreference } from '../basics/theme';
import type { RpcClient } from './contract';
import { fromRpcError } from './errors';
import type { themeContract } from './theme-contract';

export interface ThemeBridge {
  get(): Promise<ThemePreference>;
  /** Rejects with a TaalcutError (core.validation for an unknown preference). */
  set(preference: ThemePreference): Promise<void>;
  /** Changes from anywhere (another window, the app menu, macOS on System). Returns an unsubscribe. */
  onChange(listener: (preference: ThemePreference) => void): () => void;
}

export function themeBridgeOverRpc(theme: RpcClient<typeof themeContract>): ThemeBridge {
  const call = async <T>(promise: Promise<T>): Promise<T> => {
    try {
      return await promise;
    } catch (cause) {
      throw fromRpcError(cause);
    }
  };
  return {
    get: async () => (await call(theme.get())).preference,
    set: async (preference) => void (await call(theme.set({ preference }))),
    onChange(listener) {
      const controller = new AbortController();
      void (async () => {
        try {
          const changes = await theme.changed(undefined, { signal: controller.signal });
          for await (const state of changes) listener(state.preference);
        } catch {
          // Unsubscribed, or the connection to main closed (the page is going away).
        }
      })();
      return () => controller.abort();
    },
  };
}
