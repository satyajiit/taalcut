// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// Types only: lingui.config.ts loads this file, and the CLI shouldn't load core to read a list.
import type { AppLocale } from '@taalcut/core';

/** English is the source language: every message is written in English first. */
export const SOURCE_LOCALE = 'en';

/**
 * The pseudo-locale: every letter accented and every message about 30% longer
 * (Lingui's pseudoLocale, see lingui.config.ts). It shows hard-coded strings
 * (still plain English) and text that clips when a translation runs long.
 * en-XA is the conventional tag for accented pseudo-locales, so Intl falls back
 * to English formatting. Developers switch to it; users never see it.
 */
export const PSEUDO_LOCALE = 'en-XA';

/**
 * Every locale with a catalogue: the four app languages (D8, core's APP_LOCALES: English, Hindi, Spanish,
 * Brazilian Portuguese; P3-L2) and the pseudo-locale.
 */
export const APP_LANGUAGES = ['en', 'hi', 'es', 'pt-BR'] as const satisfies readonly AppLocale[];
export const LOCALES = [...APP_LANGUAGES, PSEUDO_LOCALE] as const;

// Core's APP_LOCALES and this list are the same set (a compile error otherwise).
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
export const SAME_AS_CORE: Same<AppLocale, (typeof APP_LANGUAGES)[number]> = true;

export type Locale = (typeof LOCALES)[number];

/**
 * The developer's choice in a plain browser (the dev server, the e2e suite). In Electron it is read once and moved
 * into the app's language setting; the pseudo-locale stays here, as a developer override.
 */
export const LOCALE_STORAGE_KEY = 'taalcut.locale';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

export function isAppLocale(value: unknown): value is AppLocale {
  return typeof value === 'string' && (APP_LANGUAGES as readonly string[]).includes(value);
}
