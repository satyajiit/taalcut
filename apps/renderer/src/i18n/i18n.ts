// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { i18n, type Messages } from '@lingui/core';
import { withPlatformWords, type HostPlatform } from '@taalcut/ui';
import { isLocale, LOCALE_STORAGE_KEY, PSEUDO_LOCALE, SOURCE_LOCALE, type Locale } from './locales';
import { PLATFORM_WORDS } from './platform-words';

// Each catalogue is its own chunk, compiled from the .po file by @lingui/vite-plugin.
const CATALOGUES: Record<Locale, () => Promise<{ messages: Messages }>> = {
  en: () => import('../locales/en/messages.po'),
  hi: () => import('../locales/hi/messages.po'),
  es: () => import('../locales/es/messages.po'),
  'pt-BR': () => import('../locales/pt-BR/messages.po'),
  'en-XA': () => import('../locales/en-XA/messages.po'),
};

/**
 * Loads a catalogue and makes it the active one. Components re-render through I18nProvider; the router isn't
 * touched, so drafts, scroll and selection survive (P3-L2). `<html lang>` follows, for fonts and screen readers.
 * `platform` is where the app runs (AppServices.platform): off a Mac, the sentences that name the Mac load with
 * this computer's words (UX3-MAC, platform-words.ts). Tests that leave it out get the Mac's.
 */
export async function activateLocale(locale: Locale, platform: HostPlatform = 'mac'): Promise<void> {
  const { messages } = await CATALOGUES[locale]();
  i18n.loadAndActivate({ locale, messages: withPlatformWords(messages, platform, PLATFORM_WORDS) });
  document.documentElement.lang = locale;
}

/** The developer's stored choice (a plain browser, or the pseudo-locale anywhere), else English. */
export function storedLocale(): Locale {
  try {
    const value = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return isLocale(value) ? value : SOURCE_LOCALE;
  } catch {
    // Blocked storage: no stored choice.
    return SOURCE_LOCALE;
  }
}

/** The pseudo-locale is a developer override: while it is chosen, the app's language setting doesn't apply. */
export function pseudoOverride(): boolean {
  return storedLocale() === PSEUDO_LOCALE;
}

/** Keeps a developer's choice (null clears it). */
export function storeLocale(locale: Locale | null): void {
  try {
    if (locale === null) window.localStorage.removeItem(LOCALE_STORAGE_KEY);
    else window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Blocked storage: the choice lasts until reload.
    return;
  }
}

export { i18n };
