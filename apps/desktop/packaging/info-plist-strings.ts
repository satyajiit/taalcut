// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The macOS permission prompts in the app's languages (P3-L3). Info.plist carries the English usage descriptions;
 * macOS shows a language's own from `<lproj>/InfoPlist.strings` in Contents/Resources. Those files are generated
 * from main's catalogues by `pnpm --filter @taalcut/desktop i18n:extract` into packaging/info-plist/ (committed,
 * so a reviewer sees what macOS will say; test/info-plist-strings.test.ts fails when they drift) and packed
 * into the lproj folders Electron already ships (`electronLanguages`).
 */
import { join } from 'node:path';
import type { I18n, MessageDescriptor } from '@lingui/core';
import type { FileSet } from 'electron-builder';
import type { MainLocale } from '../src/main/i18n/locales';
import { LOCAL_NETWORK_USAGE, PHOTO_LIBRARY_USAGE } from '../src/main/transfer/local-network-note';
import { MICROPHONE_USAGE } from '../src/main/voice/microphone-note';

/** Info.plist key → its catalogue message. */
export const INFO_PLIST_USAGE: Readonly<Record<string, MessageDescriptor>> = {
  NSLocalNetworkUsageDescription: LOCAL_NETWORK_USAGE,
  NSMicrophoneUsageDescription: MICROPHONE_USAGE,
  NSPhotoLibraryUsageDescription: PHOTO_LIBRARY_USAGE,
};

/** The translated languages and their lproj folder names (Electron's: pt_BR, not pt-BR). English is Info.plist. */
export const INFO_PLIST_LPROJ: Readonly<Partial<Record<MainLocale, string>>> = {
  hi: 'hi',
  es: 'es',
  'pt-BR': 'pt_BR',
};

export const INFO_PLIST_DIR = join('packaging', 'info-plist');

const quote = (text: string) =>
  `"${text.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n')}"`;

/** One language's InfoPlist.strings (UTF-8, which macOS reads). */
export function infoPlistStrings(i18n: Pick<I18n, '_'>): string {
  const lines = Object.entries(INFO_PLIST_USAGE).map(
    ([key, message]) => `${quote(key)} = ${quote(i18n._(message))};`,
  );
  return `/* Generated from main's catalogue by i18n:extract (packaging/info-plist-strings.ts). Do not edit. */\n${lines.join('\n')}\n`;
}

/** packaging/info-plist/<lproj>/InfoPlist.strings, relative to the desktop package. */
export function infoPlistFile(lproj: string): string {
  return join(INFO_PLIST_DIR, lproj, 'InfoPlist.strings');
}

/** extraResources entries: each language's file into its lproj folder in Contents/Resources. */
export function infoPlistResources(projectDir: string): FileSet[] {
  return Object.values(INFO_PLIST_LPROJ).map((lproj) => ({
    from: join(projectDir, infoPlistFile(lproj)),
    to: join(`${lproj}.lproj`, 'InfoPlist.strings'),
  }));
}
