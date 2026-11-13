// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Embeds the study's query texts that the cache doesn't hold yet, with the search eval's embedder (EmbeddingGemma
 * 2 on ONNX Runtime's best device, or the mac helper's Core ML model), as `query` vectors, and writes the cache.
 * It loads a model on the GPU or Neural Engine: run it under the VideoToolbox lock. Everything after it runs on
 * the CPU from the file.
 */
import { mkdirSync, realpathSync } from 'node:fs';
import { DEFAULT_EMBEDDING_PROFILE, EMBEDDING_SPACE } from '@taalcut/vision';
import { evalEmbedder } from '../eval-embedder';
import { encodeVector, queryKey, queryVectorsOrEmpty, writeQueryVectors } from './query-vectors';

export interface EmbedProbesOptions {
  readonly texts: readonly string[];
  /** The cache file (read when it exists, then rewritten). */
  readonly out: string;
  /** EmbeddingGemma 2's ONNX component folder (its tokenizer serves Core ML too). */
  readonly modelDir: string;
  /** An `embeddinggemma-2-coreml` folder: embed on Core ML only. */
  readonly coremlDir?: string;
  /** Scratch for the helper. */
  readonly workDir: string;
  readonly log: (line: string) => void;
}

const BATCH = 16;

export async function embedProbes(
  options: EmbedProbesOptions,
): Promise<{ embedded: number; device: string }> {
  process.env.ORT_DISABLE_TELEMETRY = '1';
  mkdirSync(options.workDir, { recursive: true });
  const { embedder, checkDevice } = await evalEmbedder({
    modelDir: options.modelDir,
    imageTokens: DEFAULT_EMBEDDING_PROFILE.imageTokens,
    ...(options.coremlDir ? { coremlDir: options.coremlDir } : {}),
    tempDir: realpathSync(options.workDir),
    log: options.log,
  });
  try {
    const keys = [...new Set(options.texts.map(queryKey))];
    // The first call loads the model and fixes the device the cache is for.
    const first = await embedder.embedTexts(keys.slice(0, 1), { purpose: 'query' });
    if (!first.ok) throw new Error(`the embedder failed: ${first.error.code} ${first.error.detail ?? ''}`);
    checkDevice();
    const device = embedder.device() ?? 'unknown';
    const file = queryVectorsOrEmpty(options.out, EMBEDDING_SPACE, device);
    const missing = keys.filter((key) => file.vectors[key] === undefined);
    const vectors = { ...file.vectors };
    for (let start = 0; start < missing.length; start += BATCH) {
      const batch = missing.slice(start, start + BATCH);
      const embedded = await embedder.embedTexts(batch, { purpose: 'query' });
      if (!embedded.ok)
        throw new Error(`the embedder failed: ${embedded.error.code} ${embedded.error.detail ?? ''}`);
      batch.forEach((key, index) => {
        const vector = embedded.value[index];
        if (!vector) throw new Error(`no vector came back for "${key}"`);
        vectors[key] = encodeVector(vector);
      });
    }
    writeQueryVectors(options.out, { ...file, vectors });
    options.log(
      `${missing.length} new query vectors on ${device}, ${Object.keys(vectors).length} in ${options.out}`,
    );
    return { embedded: missing.length, device };
  } finally {
    await embedder.close();
  }
}
