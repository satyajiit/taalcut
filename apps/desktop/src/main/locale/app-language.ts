// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The app's language in main (P3-L2), wired in one place: the locale host, `appContract.locale` over it, and the
 * app menu built in that language and built again on every change. main-root calls `startAppLanguage` once.
 */
import type { I18n } from '@lingui/core';
import { createUiCommands, type EventBus, type LocaleState, type SettingsStore } from '@taalcut/core';
import type { MenuItemConstructorOptions } from 'electron';
import { appMenuTemplate, type AppMenuOptions } from '../composition/app-menu';
import { mainI18n } from '../i18n/i18n';
import type { MachineWords } from '../../platform/types';
import type { MainLocale } from '../i18n/locales';
import { resolveMainLocale } from '../i18n/resolve-main-locale';
import { createLocaleHost, localeRouter } from './locale-host';

export interface AppLanguageDeps {
  /** The machine's words (PlatformServices.words): off a Mac, main says "this computer". */
  readonly words: MachineWords;
  readonly settings: Pick<SettingsStore, 'get'>;
  readonly events: Pick<EventBus, 'on' | 'emit'>;
  /** The Mac's preferred languages, in order (app.getPreferredSystemLanguages()). */
  readonly preferred: () => readonly string[];
  readonly menu: {
    /** A product name: shown as is. */
    readonly appName: string;
    /** Development builds add reload and the developer tools. */
    readonly development: boolean;
    /** Unpackaged builds may pick main's language from the environment (resolveMainLocale). */
    readonly packaged: boolean;
    readonly env: Readonly<Record<string, string | undefined>>;
    /** The platform's shape for the menu (platform/types.ts). */
    readonly policy: AppMenuOptions['policy'];
    /** Shows a built menu: `Menu.setApplicationMenu(Menu.buildFromTemplate(template))` in the app. */
    readonly show: (template: MenuItemConstructorOptions[]) => void;
  };
}

export interface AppLanguage {
  readonly router: ReturnType<typeof localeRouter>;
  /**
   * Main's words in the app's language as it is now: for notifications, which are written later. Its `locale` lists
   * names the language's way (the download notification's jobs).
   */
  readonly i18n: Pick<I18n, '_' | 'locale'>;
  stop(): void;
}

/** Menus and notifications follow the host's resolved language, including the English fallback. */
export function menuLanguages(state: LocaleState): readonly string[] {
  return [state.resolved];
}

export async function startAppLanguage(deps: AppLanguageDeps): Promise<AppLanguage> {
  const host = await createLocaleHost({
    settings: deps.settings,
    events: deps.events,
    preferred: deps.preferred,
  });
  const { menu, events } = deps;
  const mainLocale = (state: LocaleState): MainLocale =>
    resolveMainLocale({ packaged: menu.packaged, env: menu.env, preferred: menuLanguages(state) });
  // One translator for main, switched with the app's language: the menu is built again in it, and what main
  // writes later (notifications) is in the language as it is then, with no restart.
  const i18n = mainI18n(mainLocale(host.current()), deps.words);
  const showMenu = (state: LocaleState) => {
    i18n.activate(mainLocale(state));
    menu.show(
      appMenuTemplate({
        appName: menu.appName,
        development: menu.development,
        policy: menu.policy,
        i18n,
        // ⌘1–4, ⌘, and ⌘⇧Z: the shortcuts of the same commands ⌘K lists from the agent's bus.
        commands: createUiCommands({ events }).all,
        // The menu's Go items and Settings… run the palette's items in the focused window.
        run: (action) => events.emit('ui.action', action),
      }),
    );
  };
  showMenu(host.current());
  const stopMenu = host.subscribe(showMenu);
  return {
    router: localeRouter(host),
    i18n,
    stop: () => {
      stopMenu();
      host.stop();
    },
  };
}
