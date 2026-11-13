// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createContext, useContext, useSyncExternalStore } from 'react';
import type { SoundPreference, SoundPreferenceSnapshot } from './sound-preference';
import type { InterfaceSounds } from './sound-runtime';

export type { SoundName } from './sound-player';
export { SOUNDS_STORAGE_KEY } from './sound-preference';

export interface SoundContextValue {
  readonly preference: SoundPreference;
  readonly sounds: InterfaceSounds;
  setEnabled(enabled: boolean): void;
  retry(): void;
}

export const SoundContext = createContext<SoundContextValue | null>(null);
const SILENT = () => {};
const SUBSCRIBE = () => SILENT;
const INITIAL: SoundPreferenceSnapshot = { enabled: true, ready: false, pending: false, error: null };
const INITIAL_SNAPSHOT = () => INITIAL;

/** No state or audio is created for an isolated component outside the application provider. */
export function usePlaySound(): InterfaceSounds['play'] {
  return useContext(SoundContext)?.sounds.play ?? SILENT;
}

export function useInterfaceSounds() {
  const context = useContext(SoundContext);
  const snapshot = useSyncExternalStore(
    context?.preference.subscribe ?? SUBSCRIBE,
    context?.preference.getSnapshot ?? INITIAL_SNAPSHOT,
    INITIAL_SNAPSHOT,
  );
  return {
    ...snapshot,
    setEnabled: context?.setEnabled ?? SILENT,
    retry: context?.retry ?? SILENT,
  };
}
