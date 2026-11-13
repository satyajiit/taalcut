// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  INTERFACE_SOUNDS_SETTING,
  interfaceSoundsRouter,
  interfaceSoundsStateSchema,
  type InterfaceSoundsState,
  type SettingsStore,
} from '@taalcut/core';

export interface FakeInterfaceSoundsOptions {
  readonly saved?: InterfaceSoundsState;
  readonly persist?: (state: InterfaceSoundsState) => void;
}

export function createFakeInterfaceSounds(settings: SettingsStore, options: FakeInterfaceSoundsOptions = {}) {
  // The memory store applies a seed synchronously, before the preview serves its first request.
  if (options.saved) void settings.set(INTERFACE_SOUNDS_SETTING, options.saved);
  return {
    router: interfaceSoundsRouter(settings),
    async changed() {
      const saved = await settings.get(INTERFACE_SOUNDS_SETTING);
      if (saved.ok) options.persist?.(saved.value);
    },
  };
}

export const FAKE_INTERFACE_SOUNDS_KEY = 'taalcut.fake.interface-sounds';

/** Preview-only persistence; Electron keeps the same preference in its settings store. */
export function savedInterfaceSounds(): FakeInterfaceSoundsOptions {
  const persist = (state: InterfaceSoundsState) => {
    try {
      window.localStorage.setItem(FAKE_INTERFACE_SOUNDS_KEY, JSON.stringify(state));
    } catch {
      // A blocked preview store keeps the current choice until reload.
    }
  };
  try {
    const parsed = interfaceSoundsStateSchema.safeParse(
      JSON.parse(window.localStorage.getItem(FAKE_INTERFACE_SOUNDS_KEY) ?? 'null'),
    );
    return parsed.success ? { saved: parsed.data, persist } : { persist };
  } catch {
    return { persist };
  }
}
