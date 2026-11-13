// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** LIB1-LANG: a clip's spoken language as decided, the languages you speak, and correcting a clip. */
import { describe, expect, it } from 'vitest';
import {
  appContract,
  assetSummarySchema,
  createSpokenLanguageCommands,
  defaultSpokenLanguages,
  effectiveLanguage,
  INDIAN_LANGUAGES,
  isIndianLanguage,
  LIBRARY_COMMANDS,
  libraryCommandPayloads,
  needsIndianIdentifier,
  newId,
  ok,
  SPEECH_COMMANDS,
  SPOKEN_LANGUAGE_CHOICES,
  SPOKEN_LANGUAGES_SETTING,
  spokenLanguageOutcomeSchema,
  spokenLanguagesOrDefault,
  type CommandContext,
  type SettingDefinition,
  type SettingsStore,
} from '@taalcut/core';

describe('spoken language outcome', () => {
  it('holds the languages each state allows', () => {
    expect(
      spokenLanguageOutcomeSchema.safeParse({ state: 'unclear', languages: [], confidence: 0.2 }).success,
    ).toBe(true);
    expect(
      spokenLanguageOutcomeSchema.safeParse({ state: 'mixed', languages: ['hi', 'en'], confidence: 0.7 })
        .success,
    ).toBe(true);
    expect(
      spokenLanguageOutcomeSchema.safeParse({ state: 'chosen', languages: ['or'], confidence: null }).success,
    ).toBe(true);
    // An unclear clip names nothing; a mixed one names at least two; the others exactly one.
    expect(
      spokenLanguageOutcomeSchema.safeParse({ state: 'unclear', languages: ['ne'], confidence: 0.2 }).success,
    ).toBe(false);
    expect(
      spokenLanguageOutcomeSchema.safeParse({ state: 'mixed', languages: ['hi'], confidence: 0.7 }).success,
    ).toBe(false);
    expect(
      spokenLanguageOutcomeSchema.safeParse({ state: 'detected', languages: ['hi', 'en'], confidence: 0.9 })
        .success,
    ).toBe(false);
  });

  it('files a clip under its first language, or none when unclear', () => {
    expect(effectiveLanguage({ state: 'mixed', languages: ['hi', 'en'], confidence: 0.8 })).toBe('hi');
    expect(effectiveLanguage({ state: 'unclear', languages: [], confidence: 0.1 })).toBeNull();
  });

  it('knows the Indian languages, Odia among them', () => {
    expect(INDIAN_LANGUAGES).toHaveLength(22);
    expect(isIndianLanguage('or')).toBe(true);
    expect(isIndianLanguage('hi-IN')).toBe(true);
    expect(isIndianLanguage('pt-BR')).toBe(false);
    expect(SPOKEN_LANGUAGE_CHOICES).toContain('or');
    expect(new Set(SPOKEN_LANGUAGE_CHOICES).size).toBe(SPOKEN_LANGUAGE_CHOICES.length);
  });

  it('is an optional field of the asset summary', () => {
    const summary = assetSummarySchema.shape.speech;
    expect(summary.safeParse(undefined).success).toBe(true);
    expect(summary.safeParse({ state: 'detected', languages: ['bn'], confidence: 0.93 }).success).toBe(true);
  });
});

describe('the languages you speak', () => {
  it('defaults to the app language plus English', () => {
    expect(SPOKEN_LANGUAGES_SETTING.defaultValue).toBeNull();
    expect(defaultSpokenLanguages('pt-BR')).toEqual(['pt', 'en']);
    expect(defaultSpokenLanguages('en')).toEqual(['en']);
    expect(spokenLanguagesOrDefault(null, 'hi')).toEqual(['hi', 'en']);
    expect(spokenLanguagesOrDefault(['or', 'en'], 'es')).toEqual(['or', 'en']);
  });

  it('needs the Indian-language identifier only for an Indian language', () => {
    expect(needsIndianIdentifier(null, 'en')).toBe(false);
    expect(needsIndianIdentifier(null, 'hi')).toBe(true);
    expect(needsIndianIdentifier(['or', 'en'], 'en')).toBe(true);
    expect(needsIndianIdentifier(['es', 'en'], 'es')).toBe(false);
  });

  it('is set by an undoable command', async () => {
    const values = new Map<string, unknown>();
    const settings = {
      get: <T>(setting: SettingDefinition<T>) =>
        Promise.resolve(ok((values.has(setting.key) ? values.get(setting.key) : setting.defaultValue) as T)),
      set: <T>(setting: SettingDefinition<T>, value: T) => {
        values.set(setting.key, value);
        return Promise.resolve(ok(undefined));
      },
    } as unknown as SettingsStore;
    const { setSpokenLanguages } = createSpokenLanguageCommands({ settings });
    expect(setSpokenLanguages.name).toBe(SPEECH_COMMANDS.setSpokenLanguages);
    const done = await setSpokenLanguages.handle({ languages: ['or', 'en', 'or'] }, {} as CommandContext);
    expect(done.ok && done.value.result).toEqual({ languages: ['or', 'en'] });
    expect(done.ok && done.value.inverse?.payload).toEqual({ languages: null });
    expect(values.get(SPOKEN_LANGUAGES_SETTING.key)).toEqual(['or', 'en']);
  });

  it('is read through appContract.speech', () => {
    expect(appContract.speech.spokenLanguages).toBeDefined();
  });
});

describe('library.setAssetLanguage', () => {
  const payload = libraryCommandPayloads[LIBRARY_COMMANDS.setAssetLanguage];
  it('takes a language, or null to go back to detection', () => {
    const assetId = newId<'Asset'>();
    expect(payload.safeParse({ assetId, language: 'or' }).success).toBe(true);
    expect(payload.safeParse({ assetId, language: null }).success).toBe(true);
    expect(payload.safeParse({ assetId, language: '' }).success).toBe(false);
  });
});
