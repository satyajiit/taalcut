// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The terms a search reads from a person's words (LRN1-FIX): NFC, lower case, runs of letters, digits, marks and
 * private-use characters (so a Devanagari word stays whole), a short stopword list per v1 language dropped (all of
 * them kept if nothing else is left), at most 32. The library's keyword, template and memory searches read text
 * through it, and the renderer's fake of them does too, so the fake can't disagree with the real search.
 */

/** Function words in English, Hindi, Spanish and Portuguese that would match nearly every text. */
const STOPWORDS = new Set(
  [
    // English
    'a an and are as at be by for from in into is it of on or the this that to with shot shots clip clips video videos',
    // Hindi
    'का की के को में से पर और है हैं था थी थे एक यह वह भी तो ही ने',
    // Spanish
    'el la los las un una unos unas de del en y o a al con por para que es se su',
    // Portuguese
    'o a os as um uma de do da dos das em no na nos nas e ou ao com por para que é se',
  ]
    .join(' ')
    .normalize('NFC')
    .split(/\s+/),
);

const TERM = /[\p{L}\p{N}\p{M}\p{Co}]+/gu;

/** The words' searchable terms, once each, in order. */
export function searchTerms(text: string): string[] {
  const terms = [...new Set(text.normalize('NFC').toLowerCase().match(TERM) ?? [])];
  const kept = terms.filter((term) => !STOPWORDS.has(term));
  return (kept.length > 0 ? kept : terms).slice(0, 32);
}
