// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The v1 UI languages (decision D8): English, Hindi, Spanish, Brazilian Portuguese. */
export const APP_LOCALES = ['en', 'hi', 'es', 'pt-BR'] as const;
export type AppLocale = (typeof APP_LOCALES)[number];

/** The language part of each app locale, for matching a Mac's preferred tags ('pt-PT' → 'pt-BR'). */
const LOCALE_BY_LANGUAGE: Readonly<Record<string, AppLocale>> = { en: 'en', hi: 'hi', es: 'es', pt: 'pt-BR' };

/**
 * The first preferred BCP 47 tag whose language Taalcut has (P3-L2): pt-* → pt-BR, es-* → es, hi-* → hi,
 * en-* → en; English when none matches. `preferred` is the Mac's list in order (Electron's
 * app.getPreferredSystemLanguages()).
 */
export function resolveLocale(preferred: readonly string[]): AppLocale {
  for (const tag of preferred) {
    const language = tag.trim().toLowerCase().split(/[-_]/)[0] ?? '';
    const locale = LOCALE_BY_LANGUAGE[language];
    if (locale) return locale;
  }
  return 'en';
}
