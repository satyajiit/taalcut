// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Writes packaging/info-plist/<lproj>/InfoPlist.strings from main's compiled catalogues (the end of i18n:extract). */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mainI18n } from '../src/main/i18n/i18n';
import type { MainLocale } from '../src/main/i18n/locales';
import { INFO_PLIST_LPROJ, infoPlistFile, infoPlistStrings } from './info-plist-strings';

const projectDir = join(dirname(fileURLToPath(import.meta.url)), '..');
for (const [locale, lproj] of Object.entries(INFO_PLIST_LPROJ) as [MainLocale, string][]) {
  const file = join(projectDir, infoPlistFile(lproj));
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, infoPlistStrings(mainI18n(locale)));
}
