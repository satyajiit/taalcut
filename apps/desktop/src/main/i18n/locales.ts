// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Main's locales: the renderer's (apps/renderer/src/i18n/locales.ts), the four app languages (D8; Hindi,
 * Spanish and Brazilian Portuguese are drafts until their native review, H8) and en-XA, the pseudo-locale
 * developers switch to (accented, 30% longer), never chosen from the system. No imports: lingui.config.ts
 * loads this file, and the CLI shouldn't load core to read a list (resolve-main-locale.ts resolves them).
 */
export const SOURCE_LOCALE = 'en';
export const PSEUDO_LOCALE = 'en-XA';
export const MAIN_LOCALES = [SOURCE_LOCALE, 'hi', 'es', 'pt-BR', PSEUDO_LOCALE] as const;
export type MainLocale = (typeof MAIN_LOCALES)[number];

export const isMainLocale = (value: unknown): value is MainLocale =>
  typeof value === 'string' && (MAIN_LOCALES as readonly string[]).includes(value);
