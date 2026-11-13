// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-expect-error phone modules ship as plain JavaScript for the browser.
import { LABEL_KEYS } from '../../phone/logic.mjs';
// @ts-expect-error phone modules ship as plain JavaScript for the browser.
import { loadCatalog, translate } from '../../phone/i18n.mjs';

const NAMES = ['en', 'hi', 'es', 'pt-BR', 'en-XA'] as const;
const TRANSLATED = ['hi', 'es', 'pt-BR'] as const;

function readCatalog(name: string): Record<string, string> {
  return JSON.parse(readFileSync(new URL(`../../phone/locales/${name}.json`, import.meta.url), 'utf8')) as Record<
    string,
    string
  >;
}

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

describe('catalogs', () => {
  it('has every page string in all five locales, nothing stale, and never the word assets', () => {
    for (const name of NAMES) {
      const table = readCatalog(name);
      expect(Object.keys(table).sort(), name).toEqual([...LABEL_KEYS].sort());
      for (const key of LABEL_KEYS) {
        expect(table[key]?.length, `${name}.${key}`).toBeGreaterThan(0);
        expect(table[key] ?? '').not.toMatch(/\bassets\b/i);
      }
    }
  });

  it('keeps every placeholder of the English string in each translation', () => {
    const en = readCatalog('en');
    for (const name of TRANSLATED) {
      const table = readCatalog(name);
      for (const key of LABEL_KEYS) expect(placeholders(table[key] ?? ''), `${name}.${key}`).toEqual(placeholders(en[key] ?? ''));
    }
  });

  it('translates the page: most strings differ from English in every language', () => {
    const en = readCatalog('en');
    for (const name of TRANSLATED) {
      const table = readCatalog(name);
      const same = LABEL_KEYS.filter((key: string) => table[key] === en[key]);
      expect(same.length, `${name}: ${same.join(', ')}`).toBeLessThan(6);
    }
  });

  it('calls the PIN what the Mac calls it in the same language', () => {
    for (const name of TRANSLATED) {
      const po = readFileSync(new URL(`../../../../apps/renderer/src/locales/${name}/messages.po`, import.meta.url), 'utf8');
      const macStrings = [...po.matchAll(/msgid "[^"]*\bPIN\b[^"]*"\nmsgstr "([^"]+)"/g)].map((match) => match[1] ?? '');
      expect(macStrings.length, name).toBeGreaterThan(0);
      const word = readCatalog(name)['pin.label'] ?? '';
      expect(macStrings.some((text) => text.includes(word)), `${name}: ${word}`).toBe(true);
    }
  });

  it('wraps the pseudo-locale so it cannot be mistaken for English', () => {
    const en = readCatalog('en');
    const xa = readCatalog('en-XA');
    for (const key of LABEL_KEYS) expect(xa[key]).toBe(`[» ${en[key]} «]`);
  });
});

describe('loadCatalog', () => {
  it('uses the first catalog that exists and then stops', async () => {
    const seen: string[] = [];
    const catalog = await loadCatalog(['es-MX', 'en'], async (url: string) => {
      seen.push(url);
      if (url === '/assets/es.json') return { 'pin.label': 'PIN', hello: 'Hola {name}' };
      throw new Error('missing');
    });
    expect(seen).toEqual(['/assets/es-MX.json', '/assets/es.json']);
    expect(catalog.locale).toBe('es');
    expect(translate(catalog, 'hello', { name: 'Ada' })).toBe('Hola Ada');
    expect(translate(catalog, 'missing.key')).toBe('missing.key');
    expect(translate({ 'summary.count': '{done} of {total} added' }, 'summary.count', { done: 1 })).toBe(
      '1 of {total} added',
    );
  });

  it('prefers the en-XA pseudo-locale when the phone asks for it', async () => {
    const seen: string[] = [];
    const catalog = await loadCatalog(['en-XA'], async (url: string) => {
      seen.push(url);
      if (url === '/assets/en-XA.json') return { 'pin.label': '[» PIN «]' };
      throw new Error('missing');
    });
    expect(seen).toEqual(['/assets/en-XA.json']);
    expect(catalog.locale).toBe('en-XA');
  });

  it('ignores a locale tag that is not a language and falls back to English', async () => {
    const seen: string[] = [];
    const catalog = await loadCatalog(['../../etc/passwd', 'en'], async (url: string) => {
      seen.push(url);
      if (url === '/assets/en.json') return { 'pin.label': 'PIN' };
      throw new Error('missing');
    });
    expect(seen).toEqual(['/assets/en.json']);
    expect(catalog.locale).toBe('en');
  });
});
