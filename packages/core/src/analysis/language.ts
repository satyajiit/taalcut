// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What a clip's speech is in, as Taalcut can stand behind it (LIB1-LANG). Detection names one language when it is
 * sure enough, several when the speech switches between them, and none when it isn't sure ("language unclear"):
 * never a guess shown as fact. A language the person chose wins over detection from then on. The library keeps the
 * effective language on the asset (`AssetSummary.language`: chosen, else detected, else null), so search filters
 * and the agent read one field; this outcome says how it was decided.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { spokenLanguageSchema, type SpokenLanguage } from './transcript';

/**
 * - `detected`: one language, above the confidence floor.
 * - `mixed`: two or three languages, each a real share of the speech ("Hindi and English").
 * - `unclear`: speech, but no language clears the floor.
 * - `chosen`: the person said which (library.setAssetLanguage).
 */
export const SPOKEN_LANGUAGE_STATES = ['detected', 'mixed', 'unclear', 'chosen'] as const;
export type SpokenLanguageState = (typeof SPOKEN_LANGUAGE_STATES)[number];

export interface SpokenLanguageOutcome {
  readonly state: SpokenLanguageState;
  /** Most of the speech first. One for detected and chosen, two or three for mixed, none for unclear. */
  readonly languages: readonly SpokenLanguage[];
  /** How sure detection was of the first language (0..1); null when the person chose it. */
  readonly confidence: number | null;
}

export const spokenLanguageOutcomeSchema = z
  .object({
    state: z.enum(SPOKEN_LANGUAGE_STATES),
    languages: z.array(spokenLanguageSchema).max(3),
    confidence: z.number().min(0).max(1).nullable(),
  })
  .refine(
    (outcome) =>
      outcome.state === 'unclear'
        ? outcome.languages.length === 0
        : outcome.state === 'mixed'
          ? outcome.languages.length >= 2
          : outcome.languages.length === 1,
    { message: 'The languages do not match the state' },
  );

/** The language the asset is filed under: the first one, or null when unclear. */
export function effectiveLanguage(outcome: SpokenLanguageOutcome): SpokenLanguage | null {
  return outcome.languages[0] ?? null;
}

/**
 * The 22 scheduled languages of India (BCP 47). Whisper names 14 of them and not Odia; Taalcut's Indian-language
 * identifier names all 22 and English.
 */
export const INDIAN_LANGUAGES = [
  'as',
  'bn',
  'brx',
  'doi',
  'gu',
  'hi',
  'kn',
  'kok',
  'ks',
  'mai',
  'ml',
  'mni',
  'mr',
  'ne',
  'or',
  'pa',
  'sa',
  'sat',
  'sd',
  'ta',
  'te',
  'ur',
] as const;

/** `pt-BR` → `pt`. */
export function languageBase(tag: string): string {
  return tag.toLowerCase().split('-')[0] ?? tag.toLowerCase();
}

export function isIndianLanguage(tag: string): boolean {
  return (INDIAN_LANGUAGES as readonly string[]).includes(languageBase(tag));
}

/**
 * The languages a person can say they speak, or say a clip is in: the Indian languages, then the ones Taalcut's
 * transcriber and the world's phones meet most. Each is named in the window's language (Intl.DisplayNames).
 */
export const SPOKEN_LANGUAGE_CHOICES = [
  'en',
  ...INDIAN_LANGUAGES,
  'ar',
  'de',
  'es',
  'fa',
  'fil',
  'fr',
  'he',
  'id',
  'it',
  'ja',
  'ko',
  'ms',
  'nl',
  'pl',
  'pt',
  'ru',
  'si',
  'sw',
  'th',
  'tr',
  'uk',
  'vi',
  'zh',
] as const satisfies readonly SpokenLanguage[];
