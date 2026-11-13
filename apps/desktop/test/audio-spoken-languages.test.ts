// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LIB1-LANG: what the jobs process reads per job about the languages the person speaks, and whether this Mac
 * fetches the Indian-language identifier (anuvani-lid): only when the app's or the person's languages need it, and
 * an installed one is used only while they do (never deleted).
 */
import { createMemorySettingsStore, LOCALE_SETTING, SPOKEN_LANGUAGES_SETTING, unwrap } from '@taalcut/core';
import type { ComponentManager } from '@taalcut/jobs';
import { describe, expect, it } from 'vitest';
import {
  spokenLanguageDeps,
  spokenLanguagesNow,
  wantedComponent,
} from '../src/utility/roots/audio-spoken-languages';

async function settings(locale: 'en' | 'hi', spoken: string[] | null) {
  const store = createMemorySettingsStore();
  unwrap(await store.set(LOCALE_SETTING, locale));
  unwrap(await store.set(SPOKEN_LANGUAGES_SETTING, spoken));
  return store;
}

const installed = (path: string | undefined) =>
  (() => ({ get: async () => (path ? { path } : undefined) })) as unknown as () => ComponentManager;

describe('the languages you speak, in the jobs process', () => {
  it('defaults to the app language and English, and wants the identifier only for an Indian language', async () => {
    expect(await spokenLanguagesNow(await settings('en', null))).toEqual({
      spoken: ['en'],
      wantsIdentifier: false,
    });
    expect(await spokenLanguagesNow(await settings('hi', null))).toEqual({
      spoken: ['hi', 'en'],
      wantsIdentifier: true,
    });
    expect(await spokenLanguagesNow(await settings('en', ['en', 'or']))).toEqual({
      spoken: ['en', 'or'],
      wantsIdentifier: true,
    });
  });

  it('fetches anuvani-lid only when wanted, and every other component as before', () => {
    expect(wantedComponent('anuvani-lid', { wantsIdentifier: false })).toBe(false);
    expect(wantedComponent('anuvani-lid', { wantsIdentifier: true })).toBe(true);
    expect(wantedComponent('whisper-tiny', { wantsIdentifier: false })).toBe(true);
  });

  it('uses an installed identifier only while it is wanted, and hands the prior to every job', async () => {
    const wanted = await spokenLanguageDeps(
      await settings('en', ['or', 'en']),
      installed('/c/anuvani'),
      () => {},
    )();
    expect(wanted.indicLid).toBeDefined();
    expect(await wanted.spokenLanguages?.()).toEqual(['or', 'en']);
    const unwanted = await spokenLanguageDeps(
      await settings('en', ['en']),
      installed('/c/anuvani'),
      () => {},
    )();
    expect(unwanted.indicLid).toBeUndefined();
    const missing = await spokenLanguageDeps(await settings('hi', null), installed(undefined), () => {})();
    expect(missing.indicLid).toBeUndefined();
  });
});
