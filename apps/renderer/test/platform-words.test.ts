// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * UX3-MAC's guard: an English sentence that names the Mac, its parts or its keys either has words for every other
 * computer (a pair in src/i18n/platform-words.ts, which activateLocale loads off a Mac) or is one only a Mac ever
 * shows (MAC_ONLY, each with why). A new sentence that names the Mac anywhere else fails here.
 */
import type { MessageDescriptor } from '@lingui/core';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { activateLocale, i18n } from '../src/i18n/i18n';
import { LOCALES } from '../src/i18n/locales';
import { PLATFORM_WORDS } from '../src/i18n/platform-words';

/** Words that name the Mac, its parts or its keys. */
const NAMES_THE_MAC =
  /\bMacs?\b|Mac’s|Mac's|macOS|MacBook|⌘|⌥|⌃|\bFinder\b|[Kk]eychain|Apple silicon|System Settings|\bCommand\b|\bOption\b/;

/** Sentences only a Mac shows, by catalogue key (an explicit id, else the English), and why. */
const MAC_ONLY: Readonly<Record<string, string>> = {
  macOS: 'About › This Mac’s label for the OS version, beside the chip; elsewhere the row is System',
  'models.hardware.not_apple_silicon': 'the Mac hardware probe’s shortfall for an Intel Mac',
  'models.hardware.macos_too_old': 'the Mac hardware probe’s shortfall for macOS before 14',
  'commands.system.openStorage':
    'the fix that opens System Settings: fixOn drops it off a Mac, and ⌘K never lists it',
  'Option held': 'the /dev/kit preview of the macOS window controls',
  'Plug your phone into this Mac': 'the cable tab’s way, shown only where platformFeatures().cableImport',
  'Plug your phone into this Mac with its cable.':
    'first run’s cable way, shown only where platformFeatures().cableImport',
  'Android phones with USB debugging on remember this Mac. Forget the key and they ask to allow it again.':
    'Phone help’s USB debugging key, shown only with cable import',
  'Phones can send with it off. Turning on Local Network for Taalcut in System Settings, Privacy & Security only lets Taalcut check the connection itself.':
    'Phone help’s Local Network tip, shown only where macOS has the switch (localNetworkPrivacy)',
  'Your phone can still send clips. To let Taalcut check the connection itself, turn on Local Network for Taalcut in System Settings, Privacy & Security.':
    'the Wi-Fi way’s local-network-denied note, which only a Mac’s self-test reports',
  'The original is in iCloud and isn’t on this Mac yet. Download it in Finder to play or export this clip.':
    'iCloud placeholders exist only in a Mac’s library',
};

interface Entry {
  readonly text: string;
  readonly refs: readonly string[];
}

/** The English catalogue by key: an explicit id, else the source text (Lingui's msgid). */
function englishCatalogue(): Map<string, Entry> {
  const text = readFileSync(join(import.meta.dirname, '..', 'src', 'locales', 'en', 'messages.po'), 'utf8');
  const lines = (raw: string) =>
    [...raw.matchAll(/"(.*)"/g)].map((m) => JSON.parse(`"${m[1]}"`) as string).join('');
  const out = new Map<string, Entry>();
  for (const block of text.split(/\n\n+/)) {
    const id = /^msgid ((?:".*"\n?)+)/m.exec(block);
    const str = /^msgstr ((?:".*"\n?)+)/m.exec(block);
    if (!id || !str) continue;
    const refs = [...block.matchAll(/^#: (.*)$/gm)].flatMap((m) => (m[1] ?? '').split(' '));
    out.set(lines(id[1] ?? ''), { text: lines(str[1] ?? ''), refs });
  }
  return out;
}

const english = englishCatalogue();

/** A descriptor's catalogue key: its explicit id when the catalogue has it, else its English. */
function keyOf(descriptor: MessageDescriptor): string {
  if (descriptor.id !== undefined && english.has(descriptor.id)) return descriptor.id;
  return descriptor.message ?? descriptor.id ?? '';
}

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)/g)].map((m) => m[1]).sort();
const tags = (text: string) => [...text.matchAll(/<\/?(\d+)\/?>/g)].map((m) => m[0]).sort();

describe('the window’s words for the machine', () => {
  const macKeys = new Set(PLATFORM_WORDS.map((pair) => keyOf(pair.mac)));

  it('names the Mac only where it has other computers’ words, or where only a Mac shows it', () => {
    const bare = [...english]
      .filter(([key, entry]) => NAMES_THE_MAC.test(entry.text) && !macKeys.has(key) && !(key in MAC_ONLY))
      .map(([key, entry]) => `${key} (${entry.refs.join(', ')})`);
    expect(bare).toEqual([]);
  });

  it('lists only Mac-only sentences that still exist and still name the Mac', () => {
    for (const key of Object.keys(MAC_ONLY)) {
      expect(english.get(key)?.text, key).toMatch(NAMES_THE_MAC);
      expect(macKeys.has(key), key).toBe(false);
    }
  });

  it('pairs each Mac sentence with words that don’t name it and keep its placeholders and tags', () => {
    for (const pair of PLATFORM_WORDS) {
      const mac = english.get(keyOf(pair.mac));
      expect(mac, keyOf(pair.mac)).toBeDefined();
      for (const words of [pair.computer, pair.windows ?? pair.computer]) {
        const other = english.get(keyOf(words));
        expect(other, keyOf(words)).toBeDefined();
        expect(other?.text).not.toMatch(NAMES_THE_MAC);
        expect(placeholders(other?.text ?? ''), keyOf(words)).toEqual(placeholders(mac?.text ?? ''));
        expect(tags(other?.text ?? ''), keyOf(words)).toEqual(tags(mac?.text ?? ''));
      }
    }
    expect(new Set(PLATFORM_WORDS.map((pair) => keyOf(pair.mac))).size).toBe(PLATFORM_WORDS.length);
  });

  it('says this computer’s words off a Mac in every language, and leaves a Mac’s as they were', async () => {
    for (const locale of LOCALES) {
      await activateLocale(locale, 'mac');
      const mac = PLATFORM_WORDS.map((pair) => i18n._(pair.mac));
      const computer = PLATFORM_WORDS.map((pair) => i18n._(pair.computer));
      const windows = PLATFORM_WORDS.map((pair) => i18n._(pair.windows ?? pair.computer));
      await activateLocale(locale, 'linux');
      expect(
        PLATFORM_WORDS.map((pair) => i18n._(pair.mac)),
        locale,
      ).toEqual(computer);
      await activateLocale(locale, 'windows');
      expect(
        PLATFORM_WORDS.map((pair) => i18n._(pair.mac)),
        locale,
      ).toEqual(windows);
      await activateLocale(locale, 'mac');
      expect(
        PLATFORM_WORDS.map((pair) => i18n._(pair.mac)),
        locale,
      ).toEqual(mac);
    }
    await activateLocale('en', 'linux');
    expect(i18n._({ id: 'render.presets.device' })).toBe('This computer (H.264)');
    await activateLocale('en', 'windows');
    expect(i18n._(PLATFORM_WORDS.find((pair) => pair.mac.message === 'Show in Finder')!.mac)).toBe(
      'Show in File Explorer',
    );
    await activateLocale('en');
    expect(i18n._({ id: 'render.presets.device' })).toBe('This Mac (H.264)');
  });
});
