// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** A deterministic embedder that records each call, and a template index over the memory store. */
import { ok, type Embedder, type EmbeddingPurpose } from '@taalcut/core';
import { createTemplateVectors } from '../../src/index';
import { createMemoryVectorIndex } from '../../src/test-support';
import { setupTemplates } from '../helpers/setup';

export const DIMS = 64;

/** The list's item at `index`; a test fails here when it is missing. */
export function nth<T>(list: readonly T[], index: number): T {
  const item = list[index];
  if (item === undefined) throw new Error(`no item at ${index} of ${list.length}`);
  return item;
}

/** Feature-hashed words, unit length: texts sharing words are close, nothing else is. */
export function hashVector(text: string): Float32Array {
  const vector = new Float32Array(DIMS);
  for (const word of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < word.length; i++) hash = Math.imul(hash ^ word.charCodeAt(i), 0x01000193) >>> 0;
    const slot = hash % DIMS;
    vector[slot] = (vector[slot] ?? 0) + 1;
  }
  const norm = Math.hypot(...vector) || 1;
  return vector.map((value) => value / norm);
}

export interface EmbedCall {
  readonly texts: readonly string[];
  readonly purpose: EmbeddingPurpose;
}

export function recordingEmbedder(): Embedder & { readonly calls: EmbedCall[] } {
  const calls: EmbedCall[] = [];
  return {
    calls,
    space: { model: 'test-hashing', revision: '1', dimensions: DIMS, indexName: 'test_hashing_1' },
    async embedTexts(texts, options) {
      calls.push({ texts: [...texts], purpose: options.purpose });
      return ok(texts.map(hashVector));
    },
  };
}

export function setupVectors() {
  const templates = setupTemplates({ libraryMetadata: true });
  const index = createMemoryVectorIndex('test_hashing_1_tpl', DIMS);
  const embedder = recordingEmbedder();
  const vectors = createTemplateVectors({ index, embedder, store: templates.store });
  return { ...templates, index, embedder, vectors };
}
