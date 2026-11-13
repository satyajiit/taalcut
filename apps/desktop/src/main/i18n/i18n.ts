// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Main's translations: the compiled catalogues (lingui.config.ts) behind a
 * Lingui instance for one locale. Main shows few strings (the native menu,
 * notifications, the macOS usage descriptions), so every catalogue is bundled.
 */
import { setupI18n, type I18n, type Messages } from '@lingui/core';
import { messages as en } from './locales/en/messages';
import { messages as enXA } from './locales/en-XA/messages';
import { messages as es } from './locales/es/messages';
import { messages as hi } from './locales/hi/messages';
import { messages as ptBR } from './locales/pt-BR/messages';
import type { MachineWords } from '../../platform/types';
import type { MainLocale } from './locales';
import { withMainPlatformWords } from './platform-words';

const CATALOGUES: Readonly<Record<MainLocale, Messages>> = { en, hi, es, 'pt-BR': ptBR, 'en-XA': enXA };

/**
 * Main's translator, speaking `locale`; `activate` switches it to another of main's locales in place. `words` are
 * the machine's (PlatformServices.words): off a Mac, sentences that name the Mac say "this computer" (UX3-MAC).
 */
export function mainI18n(locale: MainLocale, words: MachineWords = 'mac'): I18n {
  return setupI18n({ locale, messages: withMainPlatformWords(CATALOGUES, words) });
}
