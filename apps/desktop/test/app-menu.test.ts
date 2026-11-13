// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The app menu runs the palette's navigation items with the palette's
 * shortcuts, every label comes from main's catalogue (the pseudo-locale
 * leaves no plain English), and the theme preference goes through
 * settings.setTheme (main writes it itself only when the agent can't take the
 * command).
 */
import { describe, expect, it, vi } from 'vitest';
import {
  createCommandBus,
  createEventBus,
  createMemoryAuditLogStore,
  createMemorySettingsStore,
  createUiCommands,
  newId,
  ok,
  ProcessRestartedError,
  SETTINGS_COMMANDS,
  systemClock,
  THEME_SETTING,
  type ThemePreference,
  type UiAction,
} from '@taalcut/core';
import type { MenuItemConstructorOptions } from 'electron';
import { appMenuTemplate, toAccelerator } from '../src/main/composition/app-menu';
import { mainI18n } from '../src/main/i18n/i18n';
import { resolveMainLocale } from '../src/main/i18n/resolve-main-locale';
import { MENU_LABELS, NAVIGATION_LABELS } from '../src/main/i18n/menu-messages';
import { HELP_LABELS } from '../src/main/menu/help-navigation';
import { HISTORY_LABELS } from '../src/main/menu/navigation';
import {
  DOWNLOAD_JOB_NAMES,
  DOWNLOADS_NOTIFY_MESSAGES,
  DOWNLOADS_STOP_REASONS,
  DOWNLOADS_STOPPED_MESSAGES,
} from '../src/main/i18n/downloads-messages';
import { MCP_APPROVAL_MESSAGES } from '../src/main/i18n/mcp-messages';
import { MAIN_PLATFORM_WORDS } from '../src/main/i18n/platform-words';
import { RENDER_NOTIFY_MESSAGES } from '../src/main/i18n/render-messages';
import { PRODUCT_NOTIFY_MESSAGES } from '../src/main/i18n/product-messages';
import { LOCAL_NETWORK_USAGE, PHOTO_LIBRARY_USAGE } from '../src/main/transfer/local-network-note';
import { MICROPHONE_USAGE } from '../src/main/voice/microphone-note';
import { messages as en } from '../src/main/i18n/locales/en/messages';
import { messages as enXA } from '../src/main/i18n/locales/en-XA/messages';
import { messages as es } from '../src/main/i18n/locales/es/messages';
import { messages as hi } from '../src/main/i18n/locales/hi/messages';
import { messages as ptBR } from '../src/main/i18n/locales/pt-BR/messages';
import { themeSetting } from '../src/main/composition/theme-setting';

const submenu = (menu: MenuItemConstructorOptions[], label: string) =>
  (menu.find((entry) => entry.label === label)?.submenu ?? []) as MenuItemConstructorOptions[];

const english = mainI18n('en');
const MAC = { appMenu: true, keyboard: 'mac' } as const;
const PC = { appMenu: false, keyboard: 'pc' } as const;
const commands = createUiCommands({ events: createEventBus({ clock: systemClock }) }).all;

/** Every label in the menu, submenus included. */
const labels = (items: readonly MenuItemConstructorOptions[]): string[] =>
  items.flatMap((entry) => [
    ...(entry.label ? [entry.label] : []),
    ...(Array.isArray(entry.submenu) ? labels(entry.submenu as MenuItemConstructorOptions[]) : []),
  ]);

describe('app menu', () => {
  it('turns palette shortcuts into accelerators', () => {
    expect(toAccelerator('mod+1')).toBe('CmdOrCtrl+1');
    expect(toAccelerator('mod+,')).toBe('CmdOrCtrl+,');
    expect(toAccelerator('mod+shift+k')).toBe('CmdOrCtrl+Shift+K');
  });

  it('runs the same ui actions as the palette, ⌘1–4 under Go and ⌘, for Settings…', () => {
    const run = vi.fn<(action: UiAction) => void>();
    const menu = appMenuTemplate({
      policy: MAC,
      appName: 'Taalcut',
      development: false,
      i18n: english,
      commands,
      run,
    });
    const go = submenu(menu, 'Go');
    expect(go.map((entry) => [entry.label, entry.accelerator])).toEqual([
      ['Make', 'CmdOrCtrl+1'],
      ['Library', 'CmdOrCtrl+2'],
      ['Templates', 'CmdOrCtrl+3'],
      ['Agent', 'CmdOrCtrl+4'],
    ]);
    const settings = submenu(menu, 'Taalcut').find((entry) => entry.label === 'Settings…');
    expect(settings?.accelerator).toBe('CmdOrCtrl+,');
    (settings?.click as () => void)();
    (go[1]?.click as () => void)();
    expect(run.mock.calls).toEqual([[{ action: 'go.settings' }], [{ action: 'go.library' }]]);
  });

  it('off a Mac puts Settings… and Quit under File and keeps only the Window roles Linux has', () => {
    const run = vi.fn<(action: UiAction) => void>();
    const menu = appMenuTemplate({
      policy: PC,
      appName: 'Taalcut',
      development: false,
      i18n: english,
      commands,
      run,
    });
    expect(menu.map((entry) => entry.label)).toEqual(['File', 'Edit', 'View', 'Go', 'Window', 'Help']);
    const file = submenu(menu, 'File');
    expect(file.map((entry) => entry.role ?? entry.label ?? entry.type)).toEqual([
      'Settings…',
      'separator',
      'quit',
    ]);
    expect(file[0]?.accelerator).toBe('CmdOrCtrl+,');
    const roles = labels(menu);
    for (const macOnly of ['About Taalcut', 'Services', 'Hide Taalcut', 'Zoom', 'Bring All to Front'])
      expect(roles).not.toContain(macOnly);
    expect(submenu(menu, 'Window').map((entry) => entry.role ?? entry.type)).toEqual([
      'minimize',
      'separator',
      'close',
    ]);
    // Edit keeps its roles, so Ctrl+Z, Ctrl+C and the rest work in text fields with the menu bar hidden.
    expect(submenu(menu, 'Edit').map((entry) => entry.role ?? entry.type)).toContain('copy');
  });

  it('toggles the sidebar with ⌃⌘S on a Mac and Ctrl+B on a PC, where Ctrl+S is Save', () => {
    const sidebar = (policy: typeof MAC | typeof PC) =>
      submenu(
        appMenuTemplate({
          policy,
          appName: 'Taalcut',
          development: false,
          i18n: english,
          commands,
          run: vi.fn(),
        }),
        'View',
      ).find((entry) => entry.label === 'Toggle Sidebar')?.accelerator;
    expect(sidebar(MAC)).toBe('Ctrl+CmdOrCtrl+S');
    expect(sidebar(PC)).toBe('CmdOrCtrl+B');
  });

  it("takes its accelerators from the UI commands' shortcuts, as ⌘K lists them from the bus", () => {
    const bus = createCommandBus({ store: createMemoryAuditLogStore(), clock: systemClock });
    bus.register(...commands);
    const listed = new Map(bus.list().map((command) => [command.name, command.shortcut]));
    const menu = appMenuTemplate({
      policy: MAC,
      appName: 'Taalcut',
      development: false,
      i18n: english,
      commands,
      run: vi.fn(),
    });
    const accelerator = (name: string) => toAccelerator(listed.get(name) ?? '');
    expect(submenu(menu, 'Go').map((entry) => entry.accelerator)).toEqual(
      ['go.make', 'go.library', 'go.templates', 'go.agent'].map(accelerator),
    );
    expect(submenu(menu, 'Taalcut').find((entry) => entry.label === 'Settings…')?.accelerator).toBe(
      accelerator('go.settings'),
    );
    const edit = submenu(menu, 'Edit');
    expect(edit.find((entry) => entry.role === 'undo')?.accelerator).toBe('CmdOrCtrl+Z');
    expect(edit.find((entry) => entry.role === 'redo')?.accelerator).toBe(accelerator('edit.redo'));
    expect(accelerator('edit.redo')).toBe('CmdOrCtrl+Shift+Z');
  });

  it('adds reload and the developer tools only in development', () => {
    const roles = (development: boolean) =>
      submenu(
        appMenuTemplate({
          policy: MAC,
          appName: 'Taalcut',
          development,
          i18n: english,
          commands,
          run: () => undefined,
        }),
        'View',
      ).map((entry) => entry.role);
    expect(roles(true)).toContain('toggleDevTools');
    expect(roles(false)).not.toContain('toggleDevTools');
  });

  it('labels every item from the catalogue: English, and the pseudo-locale with no plain English left', () => {
    const menu = (locale: 'en' | 'en-XA') =>
      appMenuTemplate({
        policy: MAC,
        appName: 'Taalcut',
        development: true,
        i18n: mainI18n(locale),
        commands,
        run: () => undefined,
      });
    const plain = labels(menu('en'));
    expect(plain).toEqual(expect.arrayContaining(['About Taalcut', 'Quit Taalcut', 'Edit', 'Window', 'Go']));
    const pseudo = labels(menu('en-XA'));
    expect(pseudo).toHaveLength(plain.length);
    // The product name stays as it is; every other word is accented.
    for (const [index, label] of pseudo.entries()) {
      if (plain[index] === 'Taalcut') expect(label).toBe('Taalcut');
      else expect(label, plain[index]).not.toBe(plain[index]);
    }
    expect(pseudo).toContain('Àƀōũţ Taalcut');
  });

  it('labels the menu in Hindi, Spanish and Brazilian Portuguese, with only names left as in English', () => {
    const menu = (locale: 'en' | 'hi' | 'es' | 'pt-BR') =>
      labels(
        appMenuTemplate({
          policy: MAC,
          appName: 'Taalcut',
          development: true,
          i18n: mainI18n(locale),
          commands,
          run: () => undefined,
        }),
      );
    const plain = menu('en');
    // macOS's own Spanish and Portuguese Window menus say Zoom too; Brazilian Portuguese says "templates"
    // (its glossary: "modelos" are the AI models).
    const same = { hi: ['Taalcut'], es: ['Taalcut', 'Zoom'], 'pt-BR': ['Taalcut', 'Zoom', 'Templates'] };
    for (const locale of ['hi', 'es', 'pt-BR'] as const) {
      const translated = menu(locale);
      expect(translated).toHaveLength(plain.length);
      const english = translated.filter(
        (label, index) => label === plain[index] && !same[locale].includes(label),
      );
      expect(english, `${locale} labels still in English`).toEqual([]);
    }
    expect(menu('hi')).toContain('संपादन');
    expect(menu('es')).toContain('Edición');
    expect(menu('pt-BR')).toContain('Editar');
  });

  it('has a compiled message for every label in every locale', () => {
    // Main's one catalogue also holds the notifications' texts ("Notify me", an external agent waiting, the models'
    // download done or stopped), the Local Network and Photos alerts' and the microphone prompt's.
    const notify = [
      ...Object.values(RENDER_NOTIFY_MESSAGES).flatMap((texts) => [texts.title, texts.body]),
      ...Object.values(PRODUCT_NOTIFY_MESSAGES).flatMap((texts) => [texts.title, texts.body]),
      ...Object.values(DOWNLOADS_NOTIFY_MESSAGES).flatMap((texts) => [texts.title, texts.body]),
      ...Object.values(DOWNLOAD_JOB_NAMES),
      ...Object.values(DOWNLOADS_STOPPED_MESSAGES),
      ...Object.values(DOWNLOADS_STOP_REASONS),
      MCP_APPROVAL_MESSAGES.title,
      MCP_APPROVAL_MESSAGES.body,
      // UX3-MAC: the same notifications in another computer's words.
      ...MAIN_PLATFORM_WORDS.flatMap((pair) => [pair.computer, ...(pair.windows ? [pair.windows] : [])]),
    ];
    const ids = [
      ...Object.values(MENU_LABELS),
      ...Object.values(NAVIGATION_LABELS),
      ...Object.values(HISTORY_LABELS),
      ...Object.values(HELP_LABELS),
      ...notify,
      LOCAL_NETWORK_USAGE,
      MICROPHONE_USAGE,
      PHOTO_LIBRARY_USAGE,
    ].map((message) => message.id);
    for (const catalogue of [en, hi, es, ptBR, enXA])
      expect(Object.keys(catalogue).sort()).toEqual([...ids].sort());
  });

  it('runs in the system language it has a catalogue for, or the pseudo-locale a developer asks for', () => {
    const env = { TAALCUT_LOCALE: 'en-XA' };
    expect(resolveMainLocale({ packaged: false, env, preferred: ['en-GB'] })).toBe('en-XA');
    expect(resolveMainLocale({ packaged: true, env, preferred: ['en-GB'] })).toBe('en');
    expect(resolveMainLocale({ packaged: true, env: {}, preferred: ['en-XA', 'hi-IN', 'en-US'] })).toBe('en');
    // The four app languages, by language (P3-L2): Hindi, Spanish and Brazilian Portuguese have catalogues too.
    expect(resolveMainLocale({ packaged: true, env: {}, preferred: ['hi-IN', 'en-GB'] })).toBe('hi');
    expect(resolveMainLocale({ packaged: true, env: {}, preferred: ['fr-FR', 'es-MX'] })).toBe('es');
    expect(resolveMainLocale({ packaged: true, env: {}, preferred: ['pt-PT'] })).toBe('pt-BR');
    expect(resolveMainLocale({ packaged: true, env: {}, preferred: ['fr-FR'] })).toBe('en');
    expect(resolveMainLocale({ packaged: false, env: { TAALCUT_LOCALE: 'klingon' }, preferred: [] })).toBe(
      'en',
    );
  });
});

describe('theme setting', () => {
  function setup(dispatch: (preference: ThemePreference) => Promise<unknown>) {
    const settings = createMemorySettingsStore();
    const events = createEventBus({ clock: systemClock });
    const log = vi.fn();
    return { settings, events, log, theme: themeSetting({ settings, events, dispatch, log }) };
  }

  it("starts at 'system' and leaves saving to settings.setTheme when the agent takes it", async () => {
    const dispatch = vi.fn(async () => undefined);
    const { theme, settings } = setup(dispatch);
    expect(await theme.read()).toEqual(ok('system'));
    await theme.save('dark');
    expect(dispatch).toHaveBeenCalledWith('dark');
    expect(await settings.get(THEME_SETTING)).toEqual(ok('system'));
  });

  it('writes the setting itself while the agent is restarting', async () => {
    const { theme } = setup(() => Promise.reject(ProcessRestartedError({ process: 'agent' })));
    await theme.save('light');
    expect(await theme.read()).toEqual(ok('light'));
  });

  it('applies the saved preference after every settings.setTheme, wherever it came from', async () => {
    const { theme, settings, events } = setup(async () => undefined);
    const applied: ThemePreference[] = [];
    const stop = theme.watch((preference) => applied.push(preference));
    const changed = (name: string) =>
      events.emit('command.changed', {
        kind: 'undone',
        id: newId<'Command'>(),
        name,
        projectId: null,
        source: 'shortcut',
        actor: 'user',
      });
    await settings.set(THEME_SETTING, 'dark');
    changed(SETTINGS_COMMANDS.setTheme);
    changed('timeline.cut');
    await vi.waitFor(() => expect(applied).toEqual(['dark']));
    stop();
    changed(SETTINGS_COMMANDS.setTheme);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(applied).toEqual(['dark']);
  });
});
