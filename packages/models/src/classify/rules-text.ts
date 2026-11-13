// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Text handling for the rules router: words in any of the four v1 languages (Devanagari keeps its marks),
 * a light stemmer that folds plurals and English verb endings, and BM25 over one short document per option.
 * Pure and deterministic: the same message always scores the same.
 */

const STOPWORDS = new Set(
  [
    // English
    'a an and are as at be by can could do does for from get how i in is it its me my of on or our please the',
    'this that these those to us we what which with you your just some any so if then there here',
    // Spanish and Portuguese
    'el la los las un una unos unas de del al y o que en por para con es se lo le mi mis tu su sus este esta',
    'o a os as um uma de do da dos das e ou que em no na nos nas por para com é se meu minha seu sua este esta',
    // Hindi
    'का की के को में से है हैं और या यह वह इस उस पर भी',
  ]
    .join(' ')
    .split(' '),
);

function rawWords(text: string): string[] {
  return text
    .normalize('NFC')
    .toLowerCase()
    .split(/[^\p{L}\p{M}\p{N}]+/u)
    .filter((word) => word.length > 0);
}

/** Lowercase words of letters, marks and digits; stopwords dropped; light stemming. For BM25. */
export function words(text: string): string[] {
  return rawWords(text)
    .filter((word) => word.length > 1 && !STOPWORDS.has(word))
    .map(stem);
}

/** Every word, stemmed, stopwords kept: phrases like "what is a" still match. */
function phraseWords(text: string): string[] {
  return rawWords(text).map(stem);
}

/** Folds plurals and common English endings so 'clips', 'clipping' and 'clipped' meet 'clip'. */
export function stem(word: string): string {
  if (!/^[a-z]+$/.test(word)) return word.length > 4 && word.endsWith('s') ? word.slice(0, -1) : word;
  if (word.length > 5 && word.endsWith('ing')) return dedouble(word.slice(0, -3));
  if (word.length > 4 && word.endsWith('ed')) return dedouble(word.slice(0, -2));
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

function dedouble(word: string): string {
  return /([^aeiou])\1$/.test(word) ? word.slice(0, -1) : word;
}

/** The message as one padded, space-joined string of its words, for phrase matching. */
export function phraseText(text: string): string {
  return ` ${phraseWords(text).join(' ')} `;
}

/** Whether a phrase (one or more words) occurs in a padded phrase text, word for word. */
export function hasPhrase(padded: string, phrase: string): boolean {
  const wanted = phraseWords(phrase);
  return wanted.length > 0 && padded.includes(` ${wanted.join(' ')} `);
}

const K1 = 1.2;
const B = 0.75;

export interface Bm25Index {
  /** Score of each document id for the query words. */
  score(query: readonly string[]): Map<string, number>;
}

export function bm25(documents: ReadonlyMap<string, string>): Bm25Index {
  const docs = [...documents].map(([id, text]) => {
    const terms = new Map<string, number>();
    const list = words(text);
    for (const term of list) terms.set(term, (terms.get(term) ?? 0) + 1);
    return { id, terms, length: list.length };
  });
  const avgLength = docs.reduce((sum, d) => sum + d.length, 0) / Math.max(docs.length, 1);
  const df = new Map<string, number>();
  for (const doc of docs) for (const term of doc.terms.keys()) df.set(term, (df.get(term) ?? 0) + 1);
  const idf = (term: string) => {
    const n = df.get(term) ?? 0;
    return Math.log(1 + (docs.length - n + 0.5) / (n + 0.5));
  };
  return {
    score(query) {
      const unique = new Set(query);
      return new Map(
        docs.map((doc) => {
          let score = 0;
          for (const term of unique) {
            const tf = doc.terms.get(term);
            if (!tf) continue;
            const norm = tf + K1 * (1 - B + (B * doc.length) / Math.max(avgLength, 1));
            score += idf(term) * ((tf * (K1 + 1)) / norm);
          }
          return [doc.id, score];
        }),
      );
    },
  };
}
