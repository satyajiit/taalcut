// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Tool search: BM25 over name, family, tags, summary and description, with
 * field weights (a word in the name counts more than one in the description).
 * Small and deterministic; the catalogue is at most a few hundred tools.
 */
import type { ToolDescriptor } from './descriptor';

const K1 = 1.2;
const B = 0.75;
/** A query word that is a prefix of a tool word ('desc' → 'describe') counts this much. */
const PREFIX_WEIGHT = 0.5;
const MIN_PREFIX = 4;
const FIELD_WEIGHTS = { name: 3, family: 2, tags: 2, summary: 1.5, description: 1 } as const;

const STOPWORDS = new Set(
  'a an and are as at be by can do does for from get how i in is it its me my of on or the this to use what which with you your'.split(
    ' ',
  ),
);

/** Lowercase words, camelCase and dots split, stopwords dropped, plurals folded ('clips' → 'clip'). */
export function tokenize(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 1 && !STOPWORDS.has(word))
    .map(stem);
}

function stem(word: string): string {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

interface IndexedTool {
  readonly descriptor: ToolDescriptor;
  readonly terms: Map<string, number>;
  readonly length: number;
}

export interface SearchIndex {
  /** Tools with a positive score, best first; ties by name. */
  search(query: string): { descriptor: ToolDescriptor; score: number }[];
}

export function buildSearchIndex(descriptors: readonly ToolDescriptor[]): SearchIndex {
  const docs = descriptors.map(indexTool);
  const avgLength = docs.reduce((sum, d) => sum + d.length, 0) / Math.max(docs.length, 1);
  const documentFrequency = new Map<string, number>();
  for (const doc of docs) {
    for (const term of doc.terms.keys()) documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
  }
  const vocabulary = [...documentFrequency.keys()];
  const idf = (term: string) => {
    const df = documentFrequency.get(term) ?? 0;
    return Math.log(1 + (docs.length - df + 0.5) / (df + 0.5));
  };

  return {
    search(query) {
      const expanded = expand(new Set(tokenize(query)), vocabulary);
      if (expanded.size === 0) return [];
      return docs
        .map((doc) => {
          let score = 0;
          for (const [term, weight] of expanded) {
            const tf = doc.terms.get(term);
            if (!tf) continue;
            const norm = tf + K1 * (1 - B + (B * doc.length) / avgLength);
            score += weight * idf(term) * ((tf * (K1 + 1)) / norm);
          }
          return { descriptor: doc.descriptor, score };
        })
        .filter((hit) => hit.score > 0)
        .sort((a, b) => b.score - a.score || a.descriptor.name.localeCompare(b.descriptor.name));
    },
  };
}

/** Exact query words at full weight, plus index words they are a prefix of at a lower weight. */
function expand(words: Set<string>, vocabulary: readonly string[]): Map<string, number> {
  const weights = new Map<string, number>();
  for (const word of words) {
    weights.set(word, 1);
    if (word.length < MIN_PREFIX) continue;
    for (const term of vocabulary) {
      if (term !== word && term.startsWith(word) && !weights.has(term)) weights.set(term, PREFIX_WEIGHT);
    }
  }
  return weights;
}

function indexTool(descriptor: ToolDescriptor): IndexedTool {
  const terms = new Map<string, number>();
  let length = 0;
  const add = (text: string, weight: number) => {
    for (const term of tokenize(text)) {
      terms.set(term, (terms.get(term) ?? 0) + weight);
      length += weight;
    }
  };
  add(descriptor.name, FIELD_WEIGHTS.name);
  add(descriptor.family, FIELD_WEIGHTS.family);
  add(descriptor.tags.join(' '), FIELD_WEIGHTS.tags);
  add(descriptor.summary, FIELD_WEIGHTS.summary);
  add(descriptor.description, FIELD_WEIGHTS.description);
  return { descriptor, terms, length };
}
