// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it, vi } from 'vitest';
import {
  callRpc,
  connectRpc,
  createCommandBus,
  createEventBus,
  createMemoryAuditLogStore,
  createMemorySettingsStore,
  createSettingsCommands,
  err,
  INTERFACE_SOUNDS_SETTING,
  interfaceSoundsContract,
  interfaceSoundsRouter,
  NotFoundError,
  serveRpc,
  SETTINGS_COMMANDS,
  systemClock,
  type SettingsStore,
} from '@taalcut/core';
import { channel } from './helpers/ports';

const origin = { source: 'ui' as const, actor: 'user' };

function setup(settings: SettingsStore = createMemorySettingsStore()) {
  const bus = createCommandBus({ store: createMemoryAuditLogStore(), clock: systemClock });
  bus.register(...createSettingsCommands({ settings, events: createEventBus({ clock: systemClock }) }).all);
  return {
    settings,
    bus,
    set: (enabled: boolean) => bus.dispatch(SETTINGS_COMMANDS.setInterfaceSounds, { enabled }, origin),
    initialize: (enabled: boolean) =>
      bus.dispatch(SETTINGS_COMMANDS.initializeInterfaceSounds, { enabled }, origin),
    state: () => settings.get(INTERFACE_SOUNDS_SETTING),
  };
}

describe('interface sound preference', () => {
  it('starts enabled and uninitialized and exposes the same state over RPC', async () => {
    const world = setup();
    const ports = channel();
    serveRpc(interfaceSoundsRouter(world.settings), ports.port1, { context: {} });
    const client = connectRpc(interfaceSoundsContract, ports.port2, { peer: 'agent' }).client;
    expect(await client.state()).toEqual({ enabled: true, initialized: false });
    expect((await world.initialize(false)).ok).toBe(true);
    expect(await client.state()).toEqual({ enabled: false, initialized: true });
  });

  it('preserves migrated off and makes repeated initialization a no-op', async () => {
    const world = setup();
    const write = vi.spyOn(world.settings, 'set');
    expect((await world.initialize(false)).ok).toBe(true);
    expect((await world.initialize(true)).ok).toBe(true);
    expect(write).toHaveBeenCalledTimes(1);
    expect(await world.state()).toEqual({ ok: true, value: { enabled: false, initialized: true } });
    expect(await world.bus.undo(null, origin)).toEqual({ ok: true, value: null });
  });

  it('never replaces an explicit choice with legacy off and preserves it through undo and redo', async () => {
    const world = setup();
    await world.initialize(false);
    await world.set(true);
    await world.initialize(false);
    expect(await world.state()).toEqual({ ok: true, value: { enabled: true, initialized: true } });
    expect((await world.bus.undo(null, origin)).ok).toBe(true);
    expect(await world.state()).toEqual({ ok: true, value: { enabled: false, initialized: true } });
    expect((await world.bus.redo(null, origin)).ok).toBe(true);
    expect(await world.state()).toEqual({ ok: true, value: { enabled: true, initialized: true } });
  });

  it('serializes simultaneous initialization and choices on the app-wide command queue', async () => {
    const world = setup();
    const results = await Promise.all([world.initialize(false), world.set(true), world.initialize(false)]);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(await world.state()).toEqual({ ok: true, value: { enabled: true, initialized: true } });
  });

  it('rejects malformed command payloads before changing the preference', async () => {
    const world = setup();
    const result = await world.bus.dispatch(SETTINGS_COMMANDS.setInterfaceSounds, { enabled: 'yes' }, origin);
    expect(result.ok).toBe(false);
    expect(await world.state()).toEqual({ ok: true, value: { enabled: true, initialized: false } });
  });

  it('returns read failures to both commands and the state query without writing', async () => {
    const failure = NotFoundError({ entity: 'settings' });
    const settings = createMemorySettingsStore();
    vi.spyOn(settings, 'get').mockResolvedValue(err(failure));
    const write = vi.spyOn(settings, 'set');
    const world = setup(settings);
    expect(await world.set(false)).toEqual({ ok: false, error: failure });
    expect(await world.initialize(false)).toEqual({ ok: false, error: failure });
    expect(write).not.toHaveBeenCalled();
    const ports = channel();
    serveRpc(interfaceSoundsRouter(settings), ports.port1, { context: {} });
    const client = connectRpc(interfaceSoundsContract, ports.port2, { peer: 'agent' }).client;
    expect(await callRpc(client.state())).toMatchObject({ ok: false, error: { code: failure.code } });
  });

  it('does not claim initialization or a choice was saved when persistence fails', async () => {
    const failure = NotFoundError({ entity: 'settings' });
    const world = setup();
    vi.spyOn(world.settings, 'set').mockResolvedValue(err(failure));
    expect(await world.initialize(false)).toEqual({ ok: false, error: failure });
    expect(await world.set(false)).toEqual({ ok: false, error: failure });
    expect(await world.state()).toEqual({ ok: true, value: { enabled: true, initialized: false } });
  });
});
