// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { defineConfig } from '@lingui/conf';
import { formatter } from '@lingui/format-po';
import { LOCALES, PSEUDO_LOCALE, SOURCE_LOCALE } from './src/i18n/locales';

/**
 * One catalogue for the whole UI: the renderer and the UI kit (packages/ui).
 * `pnpm --filter @taalcut/renderer i18n:extract` updates src/locales/<locale>/messages.po.
 * The Vite plugin compiles a catalogue when it is imported; there is no separate
 * compile step.
 */
export default defineConfig({
  sourceLocale: SOURCE_LOCALE,
  // The four app languages (P3-L2; Hindi, Spanish and Brazilian Portuguese are draft catalogues until their
  // native review, src/locales/status.json) and the pseudo-locale.
  locales: [...LOCALES],
  // Accented, 30% longer. The padding is a visible tilde, not a space, so HTML
  // can't collapse it and the extra width really shows up in layouts.
  pseudoLocale: { locale: PSEUDO_LOCALE, extend: 0.3, extendCharacter: '~' },
  fallbackLocales: { default: SOURCE_LOCALE },
  // File names without line numbers, so unrelated edits don't churn the catalogue.
  format: formatter({ lineNumbers: false }),
  catalogs: [
    {
      path: '<rootDir>/src/locales/{locale}/messages',
      include: ['<rootDir>/src', '<rootDir>/../../packages/ui/src'],
      exclude: ['**/node_modules/**', '**/*.gen.ts'],
    },
  ],
});
