// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { msg } from '@lingui/core/macro';
import { describe, expect, it, vi } from 'vitest';
import { activateLocale, i18n, storedLocale, storeLocale } from '../src/i18n/i18n';
import { isAppLocale, isLocale, LOCALE_STORAGE_KEY, LOCALES, PSEUDO_LOCALE } from '../src/i18n/locales';

describe('locales', () => {
  it('knows the four app languages and the pseudo-locale (P3-L2)', () => {
    for (const locale of ['en', 'hi', 'es', 'pt-BR', 'en-XA']) expect(isLocale(locale)).toBe(true);
    expect(isLocale('pt-PT')).toBe(false);
    expect(isLocale(undefined)).toBe(false);
    expect(isAppLocale('hi')).toBe(true);
    expect(isAppLocale('en-XA')).toBe(false);
  });

  it('starts in English unless a valid locale is stored', () => {
    expect(storedLocale()).toBe('en');
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'klingon');
    expect(storedLocale()).toBe('en');
    storeLocale(PSEUDO_LOCALE);
    expect(storedLocale()).toBe(PSEUDO_LOCALE);
  });

  it('falls back to English when storage is blocked', () => {
    const spy = vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    expect(storedLocale()).toBe('en');
    expect(() => storeLocale('en')).not.toThrow();
    spy.mockRestore();
  });
});

describe('catalogues', () => {
  const library = msg`Library`;

  it('loads English and sets <html lang>', async () => {
    await activateLocale('en');
    expect(i18n._(library)).toBe('Library');
    expect(document.documentElement.lang).toBe('en');
  });

  it('every locale’s catalogue loads and sets <html lang>', async () => {
    for (const locale of LOCALES) {
      await activateLocale(locale);
      expect(i18n.locale).toBe(locale);
      expect(document.documentElement.lang).toBe(locale);
      expect(i18n._(library).length).toBeGreaterThan(0);
    }
    await activateLocale('en');
  });

  it('pseudo-localises: accented and about 30% longer', async () => {
    await activateLocale(PSEUDO_LOCALE);
    const sentence = msg`Tell Taalcut what to make`;
    const pseudo = i18n._(sentence);
    expect(pseudo).not.toMatch(/[A-Za-z]{3,}/);
    expect(pseudo.length).toBeGreaterThanOrEqual(Math.floor('Tell Taalcut what to make'.length * 1.25));
    expect(document.documentElement.lang).toBe('en-XA');
  });
});
