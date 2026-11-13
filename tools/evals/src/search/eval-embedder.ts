// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The search eval's embedder: EmbeddingGemma 2 on this Mac's best ONNX device, or, with `coremlDir`, only the mac
 * helper's Core ML model (IX2-E5), the backend the app puts first on macOS 15, so the eval scores the vectors users
 * get there. The Core ML path needs the development helper; the ONNX component's folder gives the tokenizer.
 */
import {
  createEmbedder,
  DEFAULT_EMBEDDING_PROFILE,
  developmentCoreMlLoader,
  type EmbeddingModelLoader,
  type ImageTokenBudget,
  type NativeEmbeddingBackend,
  type VisionEmbedder,
} from '@taalcut/vision';

export interface EvalEmbedderOptions {
  readonly modelDir: string;
  readonly imageTokens: ImageTokenBudget;
  /** An unpacked `embeddinggemma-2-coreml` folder: embed on Core ML and nothing else. */
  readonly coremlDir?: string;
  /** Where frames are written for the helper, a resolved path. */
  readonly tempDir: string;
  /** Tests: a stand-in loader instead of transformers.js. */
  readonly loader?: EmbeddingModelLoader;
  readonly log: (line: string) => void;
}

export interface EvalEmbedder {
  readonly embedder: VisionEmbedder;
  /** Throws when the eval asked for Core ML and the library was embedded on another device. */
  checkDevice(): void;
}

async function coreMlBackend(
  coremlDir: string,
  tokenizerDir: string,
  tempDir: string,
): Promise<NativeEmbeddingBackend> {
  const loader = await developmentCoreMlLoader();
  if (!loader.ok) {
    throw new Error(
      `the Core ML embedder needs the mac helper (${loader.error.code}): run native/mac-helper/build.sh`,
    );
  }
  return { available: async () => true, load: () => loader.value({ coremlDir, tokenizerDir, tempDir }) };
}

export async function evalEmbedder(options: EvalEmbedderOptions): Promise<EvalEmbedder> {
  const coreml = options.coremlDir
    ? await coreMlBackend(options.coremlDir, options.modelDir, options.tempDir)
    : undefined;
  const embedder = createEmbedder({
    modelDir: options.modelDir,
    ...(options.loader ? { loader: options.loader } : {}),
    profile: {
      ...DEFAULT_EMBEDDING_PROFILE,
      imageTokens: options.imageTokens,
      ...(coreml ? { devices: ['coreml'] } : {}),
    },
    ...(coreml ? { native: { coreml } } : {}),
    onDeviceFailed: (device, detail) => options.log(`the embedder didn't load on ${device}: ${detail}`),
    onFallback: (event) => options.log(`compute fallback ${event.operation}: ${event.reason}`),
  });
  return {
    embedder,
    checkDevice() {
      if (coreml && embedder.device() !== 'coreml') {
        throw new Error(
          `--coreml-dir: the library was embedded on ${embedder.device() ?? 'nothing'}, not Core ML`,
        );
      }
    },
  };
}
