// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A deterministic stand-in for EmbeddingGemma 2 in tests: text becomes the
 * unit sum of the concepts its words name, in any of the four v1 languages
 * ("sunset", "सूर्यास्त", "atardecer" and "pôr do sol" are one concept), plus
 * a small hashed share per unknown word. Search tests can then reason about
 * which shots a query should find, in every language, without a model.
 */
import { ok, type Embedder, type EmbeddingSpace } from '@taalcut/core';

/** Concept → words naming it (lower case, NFC). Multi-word names are matched as phrases. */
const RAW_CONCEPTS: Readonly<Record<string, readonly string[]>> = {
  sunset: [
    'sunset',
    'golden hour',
    'dusk',
    'सूर्यास्त',
    'शाम',
    'atardecer',
    'puesta de sol',
    'pôr do sol',
    'entardecer',
  ],
  sunrise: ['sunrise', 'dawn', 'सूर्योदय', 'amanecer', 'nascer do sol'],
  beach: ['beach', 'shore', 'sand', 'waves', 'समुद्र तट', 'बीच', 'playa', 'arena', 'praia', 'areia'],
  sea: ['sea', 'ocean', 'समुद्र', 'mar', 'océano', 'oceano'],
  city: ['city', 'street', 'traffic', 'neon', 'शहर', 'सड़क', 'ciudad', 'calle', 'cidade', 'rua'],
  night: ['night', 'रात', 'noche', 'noite'],
  mountain: ['mountain', 'mountains', 'snow', 'पहाड़', 'बर्फ', 'montaña', 'nieve', 'montanha', 'neve'],
  food: ['food', 'griddle', 'street food', 'खाना', 'comida', 'comida de rua'],
  diwali: ['diwali', 'diya', 'diyas', 'दिवाली', 'दीया', 'दीये'],
  fireworks: ['fireworks', 'पटाखे', 'आतिशबाजी', 'fuegos artificiales', 'fogos de artifício'],
  wedding: ['wedding', 'शादी', 'boda', 'casamento'],
  dance: ['dance', 'dancing', 'नाच', 'नृत्य', 'baile', 'bailando', 'dança', 'dançando'],
  dog: ['dog', 'puppy', 'कुत्ता', 'perro', 'cachorro'],
  park: ['park', 'पार्क', 'parque'],
  office: ['office', 'desk', 'laptop', 'दफ़्तर', 'ऑफिस', 'oficina', 'escritório'],
  market: ['market', 'vegetable', 'vegetables', 'बाज़ार', 'सब्ज़ी', 'mercado', 'verduras', 'legumes'],
  kids: ['kids', 'children', 'बच्चे', 'niños', 'crianças'],
};

export const CONCEPTS: Readonly<Record<string, readonly string[]>> = Object.fromEntries(
  Object.entries(RAW_CONCEPTS).map(([name, words]) => [name, words.map((w) => w.normalize('NFC'))]),
);

const NAMES = Object.keys(CONCEPTS);
export const FAKE_DIMENSIONS = 64;
/** Concepts take the first dimensions; unknown words hash into the rest. */
const WORD_DIMS = FAKE_DIMENSIONS - NAMES.length;

export const FAKE_SPACE: EmbeddingSpace = {
  model: 'fake-concepts',
  revision: '1',
  dimensions: FAKE_DIMENSIONS,
  indexName: 'fake_concepts_1',
};

function hash(word: string): number {
  let h = 2166136261;
  for (let i = 0; i < word.length; i++) h = Math.imul(h ^ word.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** The concepts named in `text`, in order of appearance (each once). */
export function conceptsOf(text: string): string[] {
  const lower = ` ${text
    .normalize('NFC')
    .toLowerCase()
    .replace(/[.,!?;:"“”()]/g, ' ')} `;
  return NAMES.filter((name) => CONCEPTS[name]!.some((word) => lower.includes(` ${word} `)));
}

/** The unit vector for `text`; `noise` (0..1) mixes in a seeded random share, for frame-like vectors. */
export function embedText(text: string, noise = 0, seed = 0): Float32Array {
  const vector = new Float32Array(FAKE_DIMENSIONS);
  for (const concept of conceptsOf(text)) vector[NAMES.indexOf(concept)]! += 1;
  const known = new Set(Object.values(CONCEPTS).flat());
  for (const word of text.normalize('NFC').toLowerCase().split(/\s+/).filter(Boolean)) {
    if (!known.has(word)) vector[NAMES.length + (hash(word) % WORD_DIMS)]! += 0.15;
  }
  if (noise > 0) {
    let state = (seed * 2654435761) >>> 0;
    for (let i = 0; i < FAKE_DIMENSIONS; i++) {
      state = (Math.imul(state ^ (state >>> 15), 2246822507) + 0x9e3779b9) >>> 0;
      vector[i]! += noise * (state / 4294967296 - 0.5);
    }
  }
  let norm = 0;
  for (const v of vector) norm += v * v;
  if (norm === 0) vector[NAMES.length]! = norm = 1;
  const scale = 1 / Math.sqrt(norm);
  return vector.map((v) => v * scale);
}

export interface FakeEmbedder extends Embedder {
  /** Every text embedded so far, in order (to check the query was embedded once). */
  readonly calls: string[][];
}

/** core's Embedder over embedText. */
export function createFakeEmbedder(): FakeEmbedder {
  const calls: string[][] = [];
  return {
    space: FAKE_SPACE,
    calls,
    async embedTexts(texts) {
      calls.push([...texts]);
      return ok(texts.map((text) => embedText(text)));
    },
  };
}
