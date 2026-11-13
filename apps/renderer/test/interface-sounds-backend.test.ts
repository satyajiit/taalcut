// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { SETTINGS_COMMANDS } from '@taalcut/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeBackend } from '../src/backend/fake/fake-backend';
import { FAKE_INTERFACE_SOUNDS_KEY, savedInterfaceSounds } from '../src/backend/fake/fake-interface-sounds';

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.removeItem(FAKE_INTERFACE_SOUNDS_KEY);
});

describe('interface sound preference through the preview backend', () => {
  it('serves the default and persists initialization, choices, undo and redo across reloads', async () => {
    const first = createFakeBackend({ interfaceSounds: savedInterfaceSounds() });
    expect(await first.client.interfaceSounds.state()).toEqual({ enabled: true, initialized: false });
    const events: string[] = [];
    const stop = first.controls.events.on('command.changed', (event) => events.push(event.payload.name));
    await first.client.commands.dispatch({
      name: SETTINGS_COMMANDS.initializeInterfaceSounds,
      payload: { enabled: false },
    });
    await first.client.commands.dispatch({
      name: SETTINGS_COMMANDS.setInterfaceSounds,
      payload: { enabled: true },
    });
    await first.client.commands.undo({ projectId: null });
    expect(await first.client.interfaceSounds.state()).toEqual({ enabled: false, initialized: true });
    await vi.waitFor(() =>
      expect(savedInterfaceSounds().saved).toEqual({ enabled: false, initialized: true }),
    );
    const reloaded = createFakeBackend({ interfaceSounds: savedInterfaceSounds() });
    expect(await reloaded.client.interfaceSounds.state()).toEqual({ enabled: false, initialized: true });
    await first.client.commands.redo({ projectId: null });
    await vi.waitFor(() =>
      expect(savedInterfaceSounds().saved).toEqual({ enabled: true, initialized: true }),
    );
    expect(events).toEqual([
      SETTINGS_COMMANDS.initializeInterfaceSounds,
      SETTINGS_COMMANDS.setInterfaceSounds,
      SETTINGS_COMMANDS.setInterfaceSounds,
      SETTINGS_COMMANDS.setInterfaceSounds,
    ]);
    stop();
  });

  it('treats invalid preview data as uninitialized and tolerates blocked preview persistence', async () => {
    window.localStorage.setItem(FAKE_INTERFACE_SOUNDS_KEY, '{');
    expect(savedInterfaceSounds().saved).toBeUndefined();
    const fake = createFakeBackend({ interfaceSounds: savedInterfaceSounds() });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    await fake.client.commands.dispatch({
      name: SETTINGS_COMMANDS.setInterfaceSounds,
      payload: { enabled: false },
    });
    expect(await fake.client.interfaceSounds.state()).toEqual({ enabled: false, initialized: true });
  });
});
