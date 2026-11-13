// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The model's share of `vision.embed` (IX2-G1): the frames a read gave, embedded the stage's way (one
 * `embedImages` call per asset at the index budget), on the mac helper's Core ML model when `--coreml`
 * names its folder, else transformers.js on this Mac's devices. Memo off, so every frame runs the model.
 */
import { createEmbedder, type VisionEmbedder } from '../../src/embed/embedder';
import { DEFAULT_EMBEDDING_PROFILE } from '../../src/embed/profile';
import type { ImageTokenBudget } from '../../src/embed/space';
import type { SampledFrame } from '../../src/media/frames';
import { coreMlLoader } from '../study/coreml';
import { timed } from './timing';

export interface ModelOptions {
  readonly modelDir: string;
  /** The mac helper's Core ML model folder: the helper only; else transformers.js on this Mac's devices. */
  readonly coremlDir?: string;
  readonly tempDir: string;
  readonly imageTokens: ImageTokenBudget;
  readonly batchTokens?: number;
  readonly onFallback?: (reason: string) => void;
}

/** The embedder under test, memo off (every frame runs the model); `bench:embed` uses it too. */
export async function benchEmbedder(options: ModelOptions): Promise<VisionEmbedder> {
  const load = options.coremlDir
    ? await coreMlLoader({
        coremlDir: options.coremlDir,
        tokenizerDir: options.modelDir,
        tempDir: options.tempDir,
      })
    : undefined;
  const native = load ? { available: async () => true, load } : undefined;
  const onFallback = options.onFallback;
  return createEmbedder({
    modelDir: options.modelDir,
    profile: {
      ...DEFAULT_EMBEDDING_PROFILE,
      imageTokens: options.imageTokens,
      ...(options.batchTokens !== undefined ? { batchTokens: options.batchTokens } : {}),
      ...(native ? { devices: ['coreml'] } : {}),
    },
    memoEntries: 0,
    ...(onFallback ? { onFallback: (event: { readonly reason: string }) => onFallback(event.reason) } : {}),
    ...(native ? { native: { coreml: native } } : {}),
  });
}

/** Milliseconds the model took for `frames` (one call, as embed-asset.ts makes it). */
export async function modelMs(embedder: VisionEmbedder, frames: readonly SampledFrame[]): Promise<number> {
  const images = frames.map((f) => ({ width: f.width, height: f.height, rgb: f.data }));
  const run = await timed(() => embedder.embedImages(images));
  if (!run.value.ok) throw new Error(`embed: ${run.value.error.code}`);
  return run.ms;
}
