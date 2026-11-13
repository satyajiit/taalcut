// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { resolveLocale } from '@taalcut/core';
import { isMainLocale, type MainLocale } from './locales';

/** Unpackaged builds only: the locale to run main in, e.g. TAALCUT_LOCALE=en-XA. */
export const LOCALE_ENV = 'TAALCUT_LOCALE';

export interface LocaleSources {
  readonly packaged: boolean;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** The languages to follow, in order: the app's choice, or the Mac's (['hi-IN', 'en-GB']). */
  readonly preferred: readonly string[];
}

/**
 * A developer's TAALCUT_LOCALE in an unpackaged build, else the first of the languages Taalcut has, by
 * language as core's resolveLocale reads them ('en-GB' is en, 'pt-PT' is pt-BR, 'hi-IN' is hi), else English.
 */
export function resolveMainLocale({ packaged, env, preferred }: LocaleSources): MainLocale {
  const chosen = env[LOCALE_ENV];
  if (!packaged && isMainLocale(chosen)) return chosen;
  return resolveLocale(preferred);
}
