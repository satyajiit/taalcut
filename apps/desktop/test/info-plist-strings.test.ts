// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// The macOS permission prompts in every app language (P3-L3): the committed InfoPlist.strings match main's
// catalogues (i18n:extract writes them), and packaging puts each into its language's lproj folder.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mainI18n } from '../src/main/i18n/i18n';
import type { MainLocale } from '../src/main/i18n/locales';
import {
  INFO_PLIST_LPROJ,
  INFO_PLIST_USAGE,
  infoPlistFile,
  infoPlistResources,
  infoPlistStrings,
} from '../packaging/info-plist-strings';

const projectDir = join(import.meta.dirname, '..');
const languages = Object.entries(INFO_PLIST_LPROJ) as [MainLocale, string][];

describe('InfoPlist.strings', () => {
  it('covers Hindi, Spanish and Brazilian Portuguese in the lproj folders Electron ships', () => {
    expect(languages).toEqual([
      ['hi', 'hi'],
      ['es', 'es'],
      ['pt-BR', 'pt_BR'],
    ]);
    expect(infoPlistResources('/p').map((entry) => entry.to)).toEqual([
      'hi.lproj/InfoPlist.strings',
      'es.lproj/InfoPlist.strings',
      'pt_BR.lproj/InfoPlist.strings',
    ]);
  });

  for (const [locale, lproj] of languages) {
    it(`${lproj}: matches main's ${locale} catalogue (run i18n:extract after changing it)`, () => {
      const committed = readFileSync(join(projectDir, infoPlistFile(lproj)), 'utf8');
      expect(committed).toBe(infoPlistStrings(mainI18n(locale)));
      for (const key of Object.keys(INFO_PLIST_USAGE))
        expect(committed).toMatch(new RegExp(`^"${key}" = ".+";$`, 'm'));
    });
  }

  it('escapes quotes and backslashes the way .strings files need', () => {
    const text = infoPlistStrings({ _: () => 'Say “hi” or "hello" \\ done' });
    expect(text).toContain('"NSMicrophoneUsageDescription" = "Say “hi” or \\"hello\\" \\\\ done";');
  });
});
