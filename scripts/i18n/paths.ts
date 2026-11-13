// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Matches `SOURCE_LOCALE` in apps/renderer/src/i18n/locales.ts. Do not offer other tags in the app. */
export const SOURCE_LOCALE = 'en';

/** Matches `PSEUDO_LOCALE`. Accented, about 30% longer. Not a translation target. */
export const PSEUDO_LOCALE = 'en-XA';

const LOCALE_TAG = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

export function repoRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..');
}

/**
 * The two sets of catalogues: the window's (the renderer's), and main's own (menu, notifications, macOS prompts),
 * in the same languages and under the same status as the window's.
 */
const CATALOGUE_DIRS = {
  window: 'apps/renderer/src/locales',
  main: 'apps/desktop/src/main/i18n/locales',
} as const;

export type CatalogueSet = keyof typeof CATALOGUE_DIRS;

export const CATALOGUE_SETS: readonly CatalogueSet[] = ['window', 'main'];

export function localesDir(root: string, set: CatalogueSet = 'window'): string {
  return join(root, CATALOGUE_DIRS[set]);
}

export function statusPath(root: string): string {
  return join(localesDir(root), 'status.json');
}

export function frozenPath(root: string): string {
  return join(localesDir(root), 'frozen-ids.json');
}

export function cataloguePath(root: string, locale: string, set: CatalogueSet = 'window'): string {
  return join(localesDir(root, set), locale, 'messages.po');
}

export function isLocaleTag(value: string): boolean {
  return LOCALE_TAG.test(value);
}

/** Path printed in errors. Absolute when the file sits outside the repo. */
export function displayPath(root: string, file: string): string {
  const rel = relative(root, file);
  if (rel.startsWith('..') || resolve(rel) === rel) return file;
  return rel;
}
