// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { PSEUDO_LOCALE } from './paths.ts';

/**
 * Cardinal categories from Unicode CLDR.
 * Chart: https://www.unicode.org/cldr/charts/47/supplemental/language_plural_rules.html
 * Rules: https://github.com/unicode-org/cldr/blob/main/common/supplemental/plurals.xml
 *
 * `pt` has no separate pt-BR row. `pt` maximizes to pt-Latn-BR, so Brazilian
 * Portuguese uses the `pt` rule: one, many, other, and `one` is `i = 0..1`
 * (0 is one). European Portuguese is `pt_PT`: same three names, but `one` is
 * `i = 1 and v = 0` (0 is other). Do not copy that number rule onto pt-BR.
 * en-XA uses English categories.
 */
export const PLURAL_CATEGORIES = ['zero', 'one', 'two', 'few', 'many', 'other'] as const;

export type PluralCategory = (typeof PLURAL_CATEGORIES)[number];

const CARDINAL: Record<string, readonly PluralCategory[]> = {
  en: ['one', 'other'],
  hi: ['one', 'other'],
  es: ['one', 'many', 'other'],
  'pt-BR': ['one', 'many', 'other'],
};

const NOTES: Record<string, string> = {
  en: 'English uses one and other. one is the integer 1. other is everything else, including 0.',
  hi: 'Hindi uses one and other. one is 0 and 1. other is the rest. 0 takes the one form, unlike English.',
  es: 'Spanish uses one, many, and other. one is exactly 1. many is an exact million (1000000, 2000000, and so on). other is everything else, including 0. Include all three.',
  'pt-BR':
    'Brazilian Portuguese uses one, many, and other. one covers 0 and 1. many is an exact million. other is the rest (2, 3, and so on). European Portuguese uses the same names, but 0 is other there and only the integer 1 is one. Do not copy the Portugal rule. There is no extra category that only Portugal uses.',
};

export function cardinalCategories(locale: string): readonly PluralCategory[] | undefined {
  if (locale === PSEUDO_LOCALE) return CARDINAL.en;
  return CARDINAL[locale];
}

export function pluralNote(locale: string): string {
  if (locale === PSEUDO_LOCALE) return NOTES.en ?? '';
  return NOTES[locale] ?? 'This locale has no CLDR plural note in the pipeline yet.';
}
