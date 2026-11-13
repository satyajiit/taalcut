// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// The phone page off a Mac (UX3-MAC): every sentence that names the Mac has a computer's words in every language,
// and a Linux or Windows lan process serves them over the Mac's, in the catalogues and in index.html's own text.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PHONE_LOCALES, phoneAssetsFromDir, withPageWords } from '../../src/phone-assets';
// @ts-expect-error phone modules ship as plain JavaScript for the browser.
import { LABEL_KEYS } from '../../phone/logic.mjs';

const PHONE_DIR = fileURLToPath(new URL('../../phone/', import.meta.url));
const NAMES_THE_MAC = /\bMacs?\b|Mac’s|macOS|⌘|\bFinder\b/;

type Words = Record<string, string>;
const read = (path: string): Words =>
  JSON.parse(readFileSync(new URL(`../../phone/locales/${path}`, import.meta.url), 'utf8')) as Words;
const decode = (bytes: Uint8Array | undefined) => new TextDecoder().decode(bytes);
const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

describe('the phone page’s words for a computer', () => {
  const en = read('en.json');
  const computer = read('computer/en.json');

  it('has them for every English sentence that names the Mac, and only for page strings', () => {
    const naming = Object.keys(en).filter((key) => NAMES_THE_MAC.test(en[key] ?? ''));
    expect(naming.length).toBeGreaterThan(0);
    expect(Object.keys(computer).sort()).toEqual(naming.sort());
    for (const key of Object.keys(computer)) expect(LABEL_KEYS).toContain(key);
  });

  it('says them in every language, without the Mac, with the same placeholders', () => {
    for (const locale of PHONE_LOCALES) {
      const words = read(`computer/${locale}.json`);
      expect(Object.keys(words).sort(), locale).toEqual(Object.keys(computer).sort());
      for (const [key, text] of Object.entries(words)) {
        expect(text, `${locale}.${key}`).not.toMatch(NAMES_THE_MAC);
        expect(placeholders(text), `${locale}.${key}`).toEqual(placeholders(en[key] ?? ''));
      }
    }
    const pseudo = read('computer/en-XA.json');
    for (const [key, text] of Object.entries(computer)) expect(pseudo[key]).toBe(`[» ${text} «]`);
  });

  it('serves a Mac the page as it is', () => {
    const assets = phoneAssetsFromDir(PHONE_DIR);
    expect(decode(assets['en.json']?.bytes)).toBe(
      readFileSync(new URL('../../phone/locales/en.json', import.meta.url), 'utf8'),
    );
    expect(decode(assets['index.html']?.bytes)).toContain('Connect to your Mac');
  });

  it('serves any other computer its words over the Mac’s, in each catalogue and in the page’s own text', () => {
    const assets = phoneAssetsFromDir(PHONE_DIR, 'computer');
    for (const locale of PHONE_LOCALES) {
      const served = JSON.parse(decode(assets[`${locale}.json`]?.bytes)) as Words;
      expect(Object.keys(served).sort(), locale).toEqual(Object.keys(read(`${locale}.json`)).sort());
      expect(
        Object.values(served).filter((text) => NAMES_THE_MAC.test(text)),
        locale,
      ).toEqual([]);
    }
    const page = decode(assets['index.html']?.bytes);
    expect(page).toContain('>Connect to your computer<');
    const shown = [...page.matchAll(/data-i18n="[\w.-]+"[^>]*>([^<]*)</g)].map((match) => match[1] ?? '');
    expect(shown.filter((text) => NAMES_THE_MAC.test(text))).toEqual([]);
  });

  it('writes words into the page as text, never markup', () => {
    expect(withPageWords('<p data-i18n="a" class="x">Mac</p><p data-i18n="b">kept</p>', { a: '<b>&' })).toBe(
      '<p data-i18n="a" class="x">&lt;b&gt;&amp;</p><p data-i18n="b">kept</p>',
    );
  });
});
