// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The study's query vectors, embedded once under the VideoToolbox lock and then read from a file: a query's vector
 * depends only on the embedder and the text, so fusion can be studied on the CPU against stored libraries. The
 * cached embedder is core's `Embedder` (what `createLibrarySearch` takes) and fails, naming the text, for any
 * query the file doesn't hold, so a study run never scores a query it didn't embed.
 */
import { existsSync } from 'node:fs';
import { defineError, err, ok, type Embedder, type EmbeddingSpace } from '@taalcut/core';
import { readJson, writeJson } from '../../files';
import { parseNamed } from '../../schema';
import { queryVectorFileSchema, type QueryVectorFile } from './schema';

export const QueryNotCached = defineError('evals.search_study_query_not_cached', { retryable: false });

export function encodeVector(vector: Float32Array): string {
  const bytes = Buffer.alloc(vector.length * 4);
  vector.forEach((value, index) => bytes.writeFloatLE(value, index * 4));
  return bytes.toString('base64');
}

export function decodeVector(text: string, dimensions: number): Float32Array {
  const bytes = Buffer.from(text, 'base64');
  if (bytes.length !== dimensions * 4)
    throw new Error(`a cached vector has ${bytes.length / 4} values, not ${dimensions}`);
  return Float32Array.from({ length: dimensions }, (_, index) => bytes.readFloatLE(index * 4));
}

export function readQueryVectors(path: string): QueryVectorFile {
  return parseNamed(queryVectorFileSchema, readJson(path), path);
}

/** The file at `path` when it exists, else an empty one for this space and device. */
export function queryVectorsOrEmpty(path: string, space: EmbeddingSpace, device: string): QueryVectorFile {
  if (!existsSync(path))
    return { v: 1, space: space.indexName, dimensions: space.dimensions, device, vectors: {} };
  const file = readQueryVectors(path);
  if (file.space !== space.indexName || file.device !== device)
    throw new Error(
      `${path} holds ${file.space} vectors from ${file.device}, not ${space.indexName} from ${device}`,
    );
  return file;
}

export function writeQueryVectors(path: string, file: QueryVectorFile): void {
  const sorted = Object.fromEntries(Object.entries(file.vectors).sort(([a], [b]) => (a < b ? -1 : 1)));
  writeJson(path, { ...file, vectors: sorted });
}

/** Query texts as search embeds them (NFC, trimmed): the cache's keys. */
export function queryKey(text: string): string {
  return text.normalize('NFC').trim();
}

/** core's Embedder over the cached vectors: query purpose only, every text must be there. */
export function cachedQueryEmbedder(
  file: QueryVectorFile,
  space: EmbeddingSpace,
): Embedder & { readonly asked: string[] } {
  if (file.space !== space.indexName)
    throw new Error(`the cached vectors are ${file.space}, the library ${space.indexName}`);
  const vectors = new Map(
    Object.entries(file.vectors).map(([text, encoded]) => [text, decodeVector(encoded, file.dimensions)]),
  );
  const asked: string[] = [];
  return {
    space,
    asked,
    async embedTexts(texts, options) {
      if (options.purpose !== 'query')
        return err(QueryNotCached(undefined, { detail: 'the study caches query vectors only' }));
      const found: Float32Array[] = [];
      for (const text of texts) {
        asked.push(text);
        const vector = vectors.get(queryKey(text));
        if (!vector) return err(QueryNotCached(undefined, { detail: `no cached vector for "${text}"` }));
        found.push(vector);
      }
      return ok(found);
    },
  };
}
