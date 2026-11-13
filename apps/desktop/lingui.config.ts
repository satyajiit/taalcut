// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { defineConfig } from '@lingui/conf';
import { formatter } from '@lingui/format-po';
import { MAIN_LOCALES, PSEUDO_LOCALE, SOURCE_LOCALE } from './src/main/i18n/locales';

/**
 * Main's own catalogue: the native menu (the renderer's is in apps/renderer).
 * Main is bundled without Lingui's macros, so messages are plain descriptors
 * marked with an i18n comment and the catalogue is compiled into the source.
 * `pnpm --filter @taalcut/desktop i18n:extract` updates the .po files and
 * src/main/i18n/locales/<locale>/messages.ts.
 */
export default defineConfig({
  sourceLocale: SOURCE_LOCALE,
  locales: [...MAIN_LOCALES],
  // As the renderer's: accented and 30% longer, padded with a visible tilde.
  pseudoLocale: { locale: PSEUDO_LOCALE, extend: 0.3, extendCharacter: '~' },
  fallbackLocales: { default: SOURCE_LOCALE },
  format: formatter({ lineNumbers: false }),
  compileNamespace: 'es',
  catalogs: [
    {
      path: '<rootDir>/src/main/i18n/locales/{locale}/messages',
      include: ['<rootDir>/src/main'],
      exclude: ['**/locales/**'],
    },
  ],
});
