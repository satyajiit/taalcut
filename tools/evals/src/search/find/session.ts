// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What `find record` and `find run` share: the library folder's manifest, FFmpeg, EmbeddingGemma 2 (the
 * descriptions' and the queries' vectors, on ONNX Runtime's best device or the mac helper's Core ML model) and the
 * decode service the app would use, with a scratch folder for frames. `close` releases them in reverse order.
 */
import { existsSync, mkdirSync, realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DecodeService, MediaContext } from '@taalcut/media';
import { DEFAULT_EMBEDDING_PROFILE, type VisionEmbedder } from '@taalcut/vision';
import { requireMediaBinaries } from '../../media-bin';
import { evalDecodeService } from '../eval-decode';
import { evalEmbedder } from '../eval-embedder';
import type { FindManifest } from './fetch';

export interface FindSessionOptions {
  readonly libraryDir: string;
  readonly workDir: string;
  readonly modelDir?: string;
  readonly coremlDir?: string;
  readonly log: (line: string) => void;
}

export interface FindSession {
  readonly manifest: FindManifest;
  readonly media: MediaContext;
  readonly embedder: VisionEmbedder;
  readonly decodeService?: DecodeService;
  readonly tempDir: string;
  close(): Promise<void>;
}

export function defaultModelDir(): string {
  return (
    process.env.TAALCUT_EMBEDDINGGEMMA_2_DIR ??
    fileURLToPath(new URL('../../../../../packages/vision/.cache/embeddinggemma-2/', import.meta.url))
  );
}

export async function readManifest(libraryDir: string): Promise<FindManifest> {
  const path = join(libraryDir, 'manifest.json');
  if (!existsSync(path)) throw new Error(`${libraryDir} has no manifest.json: run find fetch first`);
  return JSON.parse(await readFile(path, 'utf8')) as FindManifest;
}

export async function openFindSession(options: FindSessionOptions): Promise<FindSession> {
  process.env.ORT_DISABLE_TELEMETRY = '1';
  const libraryDir = resolve(options.libraryDir);
  const manifest = await readManifest(libraryDir);
  const binaries = await requireMediaBinaries();
  mkdirSync(join(options.workDir, 'tmp'), { recursive: true });
  const tempDir = realpathSync(join(options.workDir, 'tmp'));
  const modelDir = options.modelDir ?? defaultModelDir();
  if (!existsSync(join(modelDir, 'onnx')))
    throw new Error(`EmbeddingGemma 2 isn't in ${modelDir}: pass --model-dir`);
  const { embedder } = await evalEmbedder({
    modelDir,
    imageTokens: DEFAULT_EMBEDDING_PROFILE.imageTokens,
    ...(options.coremlDir ? { coremlDir: options.coremlDir } : {}),
    tempDir,
    log: options.log,
  });
  const decodeService = await evalDecodeService([libraryDir, tempDir]);
  return {
    manifest,
    media: { binaries },
    embedder,
    ...(decodeService ? { decodeService } : {}),
    tempDir,
    async close() {
      await decodeService?.close();
      await embedder.close();
    },
  };
}
