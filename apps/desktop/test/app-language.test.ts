// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  createEventBus,
  createMemorySettingsStore,
  LOCALE_SETTING,
  newId,
  SETTINGS_COMMANDS,
  systemClock,
} from '@taalcut/core';
import type { MenuItemConstructorOptions } from 'electron';
import { describe, expect, it } from 'vitest';
import { RENDER_NOTIFY_MESSAGES } from '../src/main/i18n/render-messages';
import { menuLanguages, startAppLanguage } from '../src/main/locale/app-language';
import { localeState } from '../src/main/locale/locale-host';

const setLocale = (events: ReturnType<typeof createEventBus>) =>
  events.emit('command.changed', {
    kind: 'executed',
    id: newId<'Command'>(),
    name: SETTINGS_COMMANDS.setLocale,
    projectId: null,
    source: 'ui',
    actor: 'user',
  });

describe('the app language in main', () => {
  it('keeps native menus in the resolved beta language, including automatic English fallback', () => {
    expect(menuLanguages(localeState('system', ['hi-IN', 'en-GB']))).toEqual(['en']);
    expect(menuLanguages(localeState('es', ['hi-IN']))).toEqual(['es']);
  });

  it('shows the menu at once, again after each language switch, and stops following when stopped', async () => {
    const settings = createMemorySettingsStore();
    const events = createEventBus({ clock: systemClock });
    const shown: MenuItemConstructorOptions[][] = [];
    const language = await startAppLanguage({
      words: 'mac',
      settings,
      events,
      preferred: () => ['en-US'],
      menu: {
        appName: 'Taalcut',
        development: false,
        packaged: true,
        env: {},
        policy: { appMenu: true, keyboard: 'mac' },
        show: (t) => shown.push(t),
      },
    });
    expect(shown).toHaveLength(1);
    expect(shown[0]?.[0]?.label).toBe('Taalcut');

    await settings.set(LOCALE_SETTING, 'pt-BR');
    setLocale(events);
    await expect.poll(() => shown.length).toBe(2);

    language.stop();
    setLocale(events);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(shown).toHaveLength(2);
  });

  it('speaks the new language in the menu and in notifications after a switch, with no restart', async () => {
    const settings = createMemorySettingsStore();
    const events = createEventBus({ clock: systemClock });
    const shown: MenuItemConstructorOptions[][] = [];
    const language = await startAppLanguage({
      words: 'mac',
      settings,
      events,
      preferred: () => ['en-US'],
      menu: {
        appName: 'Taalcut',
        development: false,
        packaged: true,
        env: {},
        policy: { appMenu: true, keyboard: 'mac' },
        show: (t) => shown.push(t),
      },
    });
    // Read through the live translator each time, as a notification posted later does.
    const { i18n } = language;
    const title = () => i18n._(RENDER_NOTIFY_MESSAGES.ready.title);
    expect(title()).toBe('Your video is ready');
    expect(shown[0]?.[1]?.label).toBe('Edit');

    await settings.set(LOCALE_SETTING, 'pt-BR');
    setLocale(events);
    await expect.poll(() => shown.length).toBe(2);
    expect(shown[1]?.[1]?.label).toBe('Editar');
    expect(title()).toBe('Seu vídeo está pronto');
    language.stop();
  });
});
