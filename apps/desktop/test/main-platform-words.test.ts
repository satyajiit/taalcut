// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// UX3-MAC's guard for main's own catalogue: a sentence naming the Mac either has its words for other computers
// (MAIN_PLATFORM_WORDS) or is one macOS alone shows (its usage descriptions, `macos.*`). Off a Mac, main's translator
// says "this computer" in every language; on a Mac nothing changes.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mainI18n } from '../src/main/i18n/i18n';
import { MAIN_LOCALES } from '../src/main/i18n/locales';
import { MAIN_PLATFORM_WORDS } from '../src/main/i18n/platform-words';

/** Words that name the Mac, its parts or its keys. */
const NAMES_THE_MAC =
  /\bMacs?\b|Mac’s|Mac's|macOS|MacBook|⌘|⌥|⌃|\bFinder\b|[Kk]eychain|Apple silicon|System Settings|\bCommand\b|\bOption\b/;

/** English by id, from main's English catalogue (every entry there has an explicit id). */
function englishCatalogue(): Map<string, string> {
  const text = readFileSync(new URL('../src/main/i18n/locales/en/messages.po', import.meta.url), 'utf8');
  const out = new Map<string, string>();
  for (const block of text.split(/\n\n+/)) {
    const id = /^msgid ((?:".*"\n?)+)/m.exec(block);
    const str = /^msgstr ((?:".*"\n?)+)/m.exec(block);
    if (!id || !str) continue;
    const join = (raw: string) =>
      [...raw.matchAll(/"(.*)"/g)].map((m) => JSON.parse(`"${m[1]}"`) as string).join('');
    out.set(join(id[1] ?? ''), join(str[1] ?? ''));
  }
  return out;
}

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)/g)].map((m) => m[1]).sort();

describe('main’s words for the machine', () => {
  const english = englishCatalogue();

  it('names the Mac only where it has other computers’ words, or where macOS alone shows it', () => {
    const covered = new Set(MAIN_PLATFORM_WORDS.map((pair) => pair.mac.id));
    const bare = [...english]
      .filter(([id, text]) => NAMES_THE_MAC.test(text) && !covered.has(id) && !id.startsWith('macos.'))
      .map(([id]) => id);
    expect(bare).toEqual([]);
  });

  it('pairs a Mac sentence with words that don’t name it and keep its placeholders', () => {
    for (const pair of MAIN_PLATFORM_WORDS) {
      const mac = english.get(pair.mac.id ?? '');
      expect(mac, pair.mac.id).toBeDefined();
      for (const words of [pair.computer, pair.windows ?? pair.computer]) {
        const text = english.get(words.id ?? '');
        expect(text, words.id).toBeDefined();
        expect(text).not.toMatch(NAMES_THE_MAC);
        expect(placeholders(text ?? '')).toEqual(placeholders(mac ?? ''));
      }
    }
  });

  it('says this computer off a Mac, in every language, and leaves a Mac as it was', () => {
    for (const locale of MAIN_LOCALES) {
      const mac = mainI18n(locale, 'mac');
      const linux = mainI18n(locale, 'computer');
      for (const pair of MAIN_PLATFORM_WORDS) {
        expect(linux._(pair.mac)).toBe(mac._(pair.computer));
        expect(mac._(pair.mac)).not.toBe(mac._(pair.computer));
      }
    }
    expect(mainI18n('en', 'computer')._(MAIN_PLATFORM_WORDS[0]!.mac)).toBe(
      'Everything this computer needs has downloaded. Its models work offline from now on.',
    );
    expect(mainI18n('en')._(MAIN_PLATFORM_WORDS[0]!.mac)).toBe(
      'Everything this Mac needs has downloaded. Its models work offline from now on.',
    );
  });
});
