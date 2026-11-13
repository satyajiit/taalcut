// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The fake's words, as the library reads them (LRN1-FIX), so the fake's `templates.list` and `templates.search` agree
 * and disagree exactly where the real ones do:
 *
 * - `template_fts`'s tokenizer (unicode61, remove_diacritics 2, letters, digits, marks and private use): lower case,
 *   Latin accents folded, so "Café" is the token "cafe";
 * - `templates.list`'s free text (library `ftsPrefixQuery`): its first 16 words, every one a prefix of some token
 *   (all of them, stopwords too);
 * - `templates.search`'s word list: core's `searchTerms` (the library's own rule: stopwords dropped, at most 32),
 *   folded as FTS5 folds a query, any one a prefix of some token.
 */
import { searchTerms, type Template } from '@taalcut/core';

const TOKEN = /[\p{L}\p{N}\p{M}\p{Co}]+/gu;

/** FTS5's folding: lower case, and a Latin letter's accents dropped (remove_diacritics 2). */
const fold = (word: string) =>
  word
    .normalize('NFD')
    .replace(/(\p{Script=Latin})\p{M}+/gu, '$1')
    .normalize('NFC')
    .toLowerCase();

/** The tokens FTS5 indexes for `text`. */
export const tokensOf = (text: string): string[] => (text.normalize('NFC').match(TOKEN) ?? []).map(fold);

/** True when some token starts with `word` (a quoted prefix query, `"word"*`). */
export const holds = (tokens: readonly string[], word: string): boolean =>
  tokens.some((token) => token.startsWith(word));

/** templates.list's words: the first 16, every one asked for. */
export const listWords = (text: string): string[] => tokensOf(text).slice(0, 16);

/** templates.search's terms (core `searchTerms`), folded as FTS5 folds the quoted query. */
export const queryTerms = (text: string): string[] => searchTerms(text).map(fold);

/** template_fts's indexed columns for one template, as tokens (library `ftsColumns`). */
export interface TemplateColumns {
  readonly name: readonly string[];
  /** Each slot's name and its intent's text, subject and place. */
  readonly intents: readonly string[];
  /** The on-screen words. */
  readonly overlays: readonly string[];
  readonly tags: readonly string[];
}

export function columnsOf(name: string, tags: readonly string[], template: Template): TemplateColumns {
  const intents = template.slots.flatMap((slot) => [
    slot.name ?? '',
    slot.intent.text,
    slot.intent.subject ?? '',
    slot.intent.place ?? '',
  ]);
  return {
    name: tokensOf(name),
    intents: intents.flatMap(tokensOf),
    overlays: template.text.flatMap((overlay) => tokensOf(overlay.text)),
    tags: tags.flatMap(tokensOf),
  };
}

/** Every token of the template's columns. */
export const allTokens = (columns: TemplateColumns): string[] => [
  ...columns.name,
  ...columns.intents,
  ...columns.overlays,
  ...columns.tags,
];
