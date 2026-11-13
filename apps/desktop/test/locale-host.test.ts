// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// P3-L2: main resolves the app's language (the setting, else the Mac's languages) and follows every
// settings.setLocale, from any window, ⌘K, the agent or an undo.
import { MessageChannel } from 'node:worker_threads';
import {
  connectRpc,
  createEventBus,
  createMemorySettingsStore,
  err,
  LOCALE_SETTING,
  localeContract,
  newId,
  serveRpc,
  SETTINGS_COMMANDS,
  systemClock,
  UnknownError,
  type SettingsStore,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createLocaleHost, localeRouter, localeState } from '../src/main/locale/locale-host';

const changed = (events: ReturnType<typeof createEventBus>, name: string) =>
  events.emit('command.changed', {
    kind: 'executed',
    id: newId<'Command'>(),
    name,
    projectId: null,
    source: 'ui',
    actor: 'user',
  });

describe('the locale host', () => {
  it('uses English automatically in this beta while retaining explicit contributor drafts', () => {
    expect(localeState('system', ['pt-PT', 'en-GB']).resolved).toBe('en');
    expect(localeState('system', ['fr-FR', 'hi-IN']).resolved).toBe('en');
    expect(localeState('system', ['es-MX']).resolved).toBe('en');
    expect(localeState('system', ['fr-FR']).resolved).toBe('en');
    for (const draft of ['hi', 'es', 'pt-BR'] as const) {
      expect(localeState(draft, ['en-US']).resolved).toBe(draft);
    }
    expect(localeState('es', ['hi-IN'])).toEqual({ preference: 'es', resolved: 'es', system: ['hi-IN'] });
  });

  it('reads the saved preference, then follows every settings.setLocale', async () => {
    const settings = createMemorySettingsStore();
    const events = createEventBus({ clock: systemClock });
    await settings.set(LOCALE_SETTING, 'hi');
    const host = await createLocaleHost({ settings, events, preferred: () => ['es-MX'] });
    expect(host.current()).toMatchObject({ preference: 'hi', resolved: 'hi', system: ['es-MX'] });

    const seen: string[] = [];
    const stop = host.subscribe((state) => seen.push(state.resolved));
    await settings.set(LOCALE_SETTING, 'system');
    changed(events, 'settings.setTheme');
    changed(events, SETTINGS_COMMANDS.setLocale);
    await expect.poll(() => seen).toEqual(['en']);
    stop();
    host.stop();
  });

  it('serves every window the state, and a stream that starts with it then follows each switch', async () => {
    const settings = createMemorySettingsStore();
    const events = createEventBus({ clock: systemClock });
    const host = await createLocaleHost({ settings, events, preferred: () => ['en-US'] });
    const channel = new MessageChannel();
    serveRpc(localeRouter(host), channel.port1, { context: {} });
    const { client } = connectRpc(localeContract, channel.port2, { peer: 'main' });
    expect(await client.state()).toEqual({ preference: 'system', resolved: 'en', system: ['en-US'] });

    const controller = new AbortController();
    const stream = await client.changed(undefined, { signal: controller.signal });
    const seen: string[] = [];
    const reading = (async () => {
      for await (const state of stream) {
        seen.push(state.resolved);
        if (seen.length === 2) break;
      }
    })();
    await expect.poll(() => seen).toEqual(['en']);
    await settings.set(LOCALE_SETTING, 'pt-BR');
    changed(events, SETTINGS_COMMANDS.setLocale);
    await reading;
    expect(seen).toEqual(['en', 'pt-BR']);
    controller.abort();
    channel.port1.close();
    channel.port2.close();
    host.stop();
  });

  it('falls back to Automatic when the setting can’t be read', async () => {
    const events = createEventBus({ clock: systemClock });
    const logs: string[] = [];
    const unreadable: Pick<SettingsStore, 'get'> = { get: async () => err(UnknownError()) };
    const host = await createLocaleHost({
      settings: unreadable,
      events,
      preferred: () => ['hi'],
      log: (message) => logs.push(message),
    });
    expect(host.current().resolved).toBe('en');
    expect(logs).toEqual(['[locale] not read: core.unknown']);
  });
});
