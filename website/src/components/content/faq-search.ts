// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The FAQ's search (faq-browser.tsx), pure so test/unit/geo-faq.test.ts can hold it: the words a query is made of, which
 * questions it matches, and a text split around its matches for marking. Case and the curly apostrophe don't
 * matter: "cant", "can't" and "can’t" read the same.
 */
import type { FaqEntry } from '#content/schema';

/** Folds case and apostrophes, keeping the text's length so positions still line up. */
function fold(text: string): string {
  return text.toLowerCase().replace(/[’‘]/g, "'");
}

/** The words of a query, folded, without repeats. */
export function terms(query: string): string[] {
  return [...new Set(fold(query).split(/\s+/).map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')).filter((w) => w.length > 0))];
}

export interface FaqMatch {
  /** Every word is somewhere in the question or the answer (true for an empty query). */
  readonly any: boolean;
  /** A word is in the answer, so the answer opens to show it. */
  readonly inAnswer: boolean;
}

export function matchFaq(entry: Pick<FaqEntry, 'question' | 'answer'>, words: readonly string[]): FaqMatch {
  if (words.length === 0) return { any: true, inAnswer: false };
  const question = fold(entry.question);
  const answer = fold(entry.answer);
  return {
    any: words.every((w) => question.includes(w) || answer.includes(w)),
    inAnswer: words.some((w) => answer.includes(w)),
  };
}

/** The text in runs, each marked when it is one of the words. */
export function splitMatches(text: string, words: readonly string[]): { readonly text: string; readonly match: boolean }[] {
  if (words.length === 0) return [{ text, match: false }];
  const escaped = [...words].sort((a, b) => b.length - a.length).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/'/g, "['’‘]"));
  const parts: { text: string; match: boolean }[] = [];
  let last = 0;
  for (const m of text.matchAll(new RegExp(escaped.join('|'), 'gi'))) {
    const at = m.index ?? 0;
    if (at > last) parts.push({ text: text.slice(last, at), match: false });
    parts.push({ text: m[0], match: true });
    last = at + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), match: false });
  return parts;
}
