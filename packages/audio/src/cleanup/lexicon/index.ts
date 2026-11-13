// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The filler lexicon of a language (its base subtag); English when there is none for it. */
import { EN } from './en';
import { ES } from './es';
import { HI } from './hi';
import { PT } from './pt';

export interface Lexicon {
  readonly fillers: ReadonlySet<string>;
  /** Single words and phrases; matched on normalised words. */
  readonly ambiguous: readonly (readonly string[])[];
}

const LISTS: Readonly<
  Record<string, { readonly fillers: readonly string[]; readonly ambiguous: readonly string[] }>
> = {
  en: EN,
  es: ES,
  pt: PT,
  hi: HI,
};

export function lexiconFor(language: string): Lexicon {
  const list = LISTS[language.split('-')[0] ?? language] ?? EN;
  return { fillers: new Set(list.fillers), ambiguous: list.ambiguous.map((phrase) => phrase.split(' ')) };
}

/** Lowercase NFC without surrounding punctuation: how words are compared with the lists. */
export function normaliseWord(text: string): string {
  return text
    .normalize('NFC')
    .toLowerCase()
    .replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, '');
}
