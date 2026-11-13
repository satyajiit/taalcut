// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The languages you speak (LIB1-LANG): a prior for spoken-language detection, set in Settings › General and asked
 * once in first run. Until the person answers it is null, which means the app's language plus English. Detection
 * leans toward these languages, but never names one the speech doesn't support.
 *
 * `settings.setSpokenLanguages` (agent process, write, undoable) stores it; `appContract.speech.spokenLanguages`
 * reads it. A list with an Indian language in it, or Hindi as the app's language, makes the Indian-language
 * identifier part of what this Mac downloads (`needsIndianIdentifier`).
 */
import '../basics/zod-config';
import { z } from 'zod';
import { isIndianLanguage, languageBase } from '../analysis/language';
import { spokenLanguageSchema, type SpokenLanguage } from '../analysis/transcript';
import { ok } from '../basics/result';
import { defineCommand } from '../commands/definition';
import { ipc } from '../ipc/contract';
import { defineSetting, type SettingsStore } from '../ports/preferences';

export const SPOKEN_LANGUAGES_MAX = 8;

const spokenLanguagesSchema = z.array(spokenLanguageSchema).min(1).max(SPOKEN_LANGUAGES_MAX);

/** null: not answered yet, so the app's language plus English. */
export const SPOKEN_LANGUAGES_SETTING = defineSetting(
  'speech.spokenLanguages',
  spokenLanguagesSchema.nullable(),
  null,
);

/** The first default: the app's language (its base: `pt-BR` → `pt`), then English. */
export function defaultSpokenLanguages(appLanguage: string): SpokenLanguage[] {
  return [...new Set([languageBase(appLanguage), 'en'])];
}

/** What detection leans toward: the stored list, else the default for the app's language. */
export function spokenLanguagesOrDefault(
  stored: readonly SpokenLanguage[] | null,
  appLanguage: string,
): SpokenLanguage[] {
  return stored && stored.length > 0 ? [...stored] : defaultSpokenLanguages(appLanguage);
}

/** Whether this Mac needs the Indian-language identifier: the person's languages, or the app's, include one. */
export function needsIndianIdentifier(
  stored: readonly SpokenLanguage[] | null,
  appLanguage: string,
): boolean {
  return (
    isIndianLanguage(appLanguage) || spokenLanguagesOrDefault(stored, appLanguage).some(isIndianLanguage)
  );
}

export const SPEECH_COMMANDS = { setSpokenLanguages: 'settings.setSpokenLanguages' } as const;

export const speechCommandPayloads = {
  /** null: back to the default (the app's language plus English). */
  [SPEECH_COMMANDS.setSpokenLanguages]: z.object({ languages: spokenLanguagesSchema.nullable() }),
};

export const spokenLanguagesStateSchema = z.object({
  /** As stored; null until the person answers (then the app's language plus English applies). */
  languages: spokenLanguagesSchema.nullable(),
});
export type SpokenLanguagesState = z.output<typeof spokenLanguagesStateSchema>;

/** appContract.speech, owner agent. */
export const speechContract = { spokenLanguages: ipc.output(spokenLanguagesStateSchema) };

/** `settings.setSpokenLanguages`, for the agent process's bus. */
export function createSpokenLanguageCommands(deps: { readonly settings: SettingsStore }) {
  const setSpokenLanguages = defineCommand({
    name: SPEECH_COMMANDS.setSpokenLanguages,
    payload: speechCommandPayloads[SPEECH_COMMANDS.setSpokenLanguages],
    sideEffect: 'write',
    project: () => null,
    async handle({ languages }, context) {
      const before = await deps.settings.get(SPOKEN_LANGUAGES_SETTING);
      if (!before.ok) return before;
      const unique = languages ? [...new Set(languages)] : null;
      const saved = await deps.settings.set(SPOKEN_LANGUAGES_SETTING, unique, context);
      if (!saved.ok) return saved;
      return ok({
        result: { languages: unique },
        inverse: { name: SPEECH_COMMANDS.setSpokenLanguages, payload: { languages: before.value } },
      });
    },
  });
  return { setSpokenLanguages, all: [setSpokenLanguages] };
}
