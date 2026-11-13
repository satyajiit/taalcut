// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * earshot's listening vocabulary (EAR1-F5, `vocab.py`): 322 descriptions in 16 categories, embedded through 5 prompt
 * templates, and the reference statistics that calibrate every score (the mean audio embedding `m` of 241 reference
 * recordings, and CLAP's softmax temperature). The data is vendored unchanged (@taalcut-vendor/earshot-data); the
 * term embeddings come per text dtype from the audio component (text-embeddings.ts) or the text encoder.
 */
import { SOUND_TAG_CATEGORIES, type SoundTagCategory } from '@taalcut/core';
import vocabFile from '@taalcut-vendor/earshot-data/vocab.json' with { type: 'json' };
import statsFile from '@taalcut-vendor/earshot-data/vocab_stats.json' with { type: 'json' };
import { LISTEN_CONFIG } from '../config';

export interface VocabTerms {
  /** In vocab.json's order: categories as listed, terms as listed. */
  readonly terms: readonly string[];
  readonly categories: readonly SoundTagCategory[];
  readonly templates: readonly string[];
}

export interface VocabStats {
  /** `m`: the folder-balanced mean of the reference recordings' embeddings (512). */
  readonly mean: Float32Array;
  readonly logitScale: number;
  readonly model: string;
}

/** A vocabulary with its term embeddings: what every score is calibrated against. */
export interface ListenVocab extends VocabTerms {
  /** E: one unit row per term (template-averaged). */
  readonly rows: readonly Float32Array[];
  /** E·m: each term's mean cosine over the references. */
  readonly bias: Float64Array;
  readonly stats: VocabStats;
  /** q·m for any text embedding. */
  biasOf(query: Float32Array): number;
  /** The category of the term whose text is closest (`Vocab.nearest_category`). */
  nearestCategory(query: Float32Array): SoundTagCategory;
}

const isCategory = (value: string): value is SoundTagCategory =>
  (SOUND_TAG_CATEGORIES as readonly string[]).includes(value);

let terms: VocabTerms | undefined;
let stats: VocabStats | undefined;

export function vocabTerms(): VocabTerms {
  if (terms) return terms;
  const names: string[] = [];
  const categories: SoundTagCategory[] = [];
  for (const [category, list] of Object.entries(vocabFile.categories as Record<string, string[]>)) {
    if (!isCategory(category)) throw new Error(`vocab.json: unknown category ${category}`);
    for (const term of list) {
      names.push(term);
      categories.push(category);
    }
  }
  terms = { terms: names, categories, templates: [...(vocabFile.templates as string[])] };
  return terms;
}

export function vocabStats(): VocabStats {
  if (stats) return stats;
  const mean = Float32Array.from(statsFile.mean as number[]);
  if (mean.length !== LISTEN_CONFIG.clap.embedDim) throw new Error('vocab_stats.json: mean is not 512 long');
  stats = { mean, logitScale: Number(statsFile.logit_scale), model: String(statsFile.model) };
  return stats;
}

export function dot(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] ?? 0) * (b[i] ?? 0);
  return sum;
}

/** `rows` in `vocabTerms()` order (322 unit vectors). */
export function createVocab(
  rows: readonly Float32Array[],
  base: VocabTerms = vocabTerms(),
  reference: VocabStats = vocabStats(),
): ListenVocab {
  if (rows.length !== base.terms.length) {
    throw new Error(`vocabulary embeddings: ${rows.length} rows for ${base.terms.length} terms`);
  }
  const bias = Float64Array.from(rows, (row) => dot(row, reference.mean));
  return {
    ...base,
    rows,
    bias,
    stats: reference,
    biasOf: (query) => dot(query, reference.mean),
    nearestCategory(query) {
      let best = 0;
      let bestCos = Number.NEGATIVE_INFINITY;
      rows.forEach((row, i) => {
        const c = dot(query, row);
        if (c > bestCos) [best, bestCos] = [i, c];
      });
      return base.categories[best] ?? 'everyday';
    },
  };
}
