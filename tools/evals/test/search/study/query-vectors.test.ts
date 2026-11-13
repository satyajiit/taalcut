// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** IX2-U1: cached query vectors round-trip and stand in for the embedder, refusing anything not cached. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EMBEDDING_SPACE } from '@taalcut/vision';
import { afterEach, describe, expect, it } from 'vitest';
import {
  cachedQueryEmbedder,
  decodeVector,
  encodeVector,
  queryVectorsOrEmpty,
  readQueryVectors,
  writeQueryVectors,
} from '../../../src/search/study/query-vectors';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('query vectors', () => {
  it('round-trip float32 through base64', () => {
    const vector = Float32Array.from({ length: 768 }, (_, i) => Math.sin(i) / 10);
    expect(decodeVector(encodeVector(vector), 768)).toEqual(vector);
    expect(() => decodeVector(encodeVector(vector), 512)).toThrow(/768 values, not 512/);
  });

  it('are written per space and device, and a file for another device is refused', () => {
    const dir = mkdtempSync(join(tmpdir(), 'taalcut-study-'));
    dirs.push(dir);
    const path = join(dir, 'q.json');
    const empty = queryVectorsOrEmpty(path, EMBEDDING_SPACE, 'webgpu');
    expect(empty.vectors).toEqual({});
    writeQueryVectors(path, {
      ...empty,
      vectors: { b: encodeVector(new Float32Array(768)), a: encodeVector(new Float32Array(768)) },
    });
    expect(Object.keys(readQueryVectors(path).vectors)).toEqual(['a', 'b']);
    expect(() => queryVectorsOrEmpty(path, EMBEDDING_SPACE, 'coreml')).toThrow(/from webgpu/);
  });

  it('answer query embeddings from the file and fail for a text it lacks or a document', async () => {
    const vector = Float32Array.from({ length: 768 }, (_, i) => (i === 3 ? 1 : 0));
    const embedder = cachedQueryEmbedder(
      {
        v: 1,
        space: EMBEDDING_SPACE.indexName,
        dimensions: 768,
        device: 'test',
        vectors: { मानसून: encodeVector(vector) },
      },
      EMBEDDING_SPACE,
    );
    const found = await embedder.embedTexts([' मानसून '.normalize('NFD').trim()], { purpose: 'query' });
    expect(found.ok && found.value[0]).toEqual(vector);
    const missing = await embedder.embedTexts(['monsoon'], { purpose: 'query' });
    expect(!missing.ok && missing.error.detail).toMatch(/no cached vector for "monsoon"/);
    const document = await embedder.embedTexts(['मानसून'], { purpose: 'document' });
    expect(document.ok).toBe(false);
  });
});
