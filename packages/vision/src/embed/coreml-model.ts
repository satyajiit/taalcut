// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EmbeddingGemma 2 on Core ML in the mac helper (IX2-E3, E5): `embed.prepare`, `embed.images` and `embed.texts`
 * (native/mac-helper/SPEC.md). The helper holds the compiled models of the `embeddinggemma-2-coreml` component,
 * the vision functions on the GPU and the text functions on the Neural Engine. Frames go to it as raw rgb24 files
 * in a folder it may read, texts as token ids from the ONNX component's tokenizer (the ids the ONNX path embeds),
 * and vectors come back as base64 float32. Vectors are at cosine ≥ 0.999 to the ONNX path's (vision SPEC "Core ML
 * backend"), so both share one space.
 */
import { randomUUID } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chunk, float32sFrom, type TaalcutError } from '@taalcut/core';
import { helperCode, type JsonLineSidecar, type JsonValue } from '@taalcut/media';
import { z } from 'zod';
import {
  importTransformers,
  MAX_TEXT_TOKENS,
  sameBudget,
  type EmbeddingImage,
  type EmbeddingModel,
  type Tokenizer,
} from './model';
import { IMAGE_TOKEN_BUDGETS, type ImageTokenBudget } from './space';

export interface CoreMlModelOptions {
  /** Starts the helper's embed service (`embedServeArgs`). Each load starts its own; `dispose` stops it. */
  readonly open: () => JsonLineSidecar;
  /** A folder inside the helper's `--allow-root`: frames are written here for the length of a request. */
  readonly tempDir: string;
  /** The ONNX component's folder, for its tokenizer. */
  readonly tokenizerDir: string;
  /** Test seam: the tokenizer itself. Default: transformers.js's, from `tokenizerDir`. */
  readonly tokenizer?: Tokenizer;
  /** Per request. Default 60 s. */
  readonly timeoutMs?: number;
  /** For `embed.prepare`: minutes on a Mac that has never compiled the models. Default 15 minutes. */
  readonly prepareTimeoutMs?: number;
}

/** `serve` argv for the helper's embed service over a Core ML component folder. */
export function embedServeArgs(modelsDir: string, allowRoots: readonly string[]): string[] {
  return [
    'serve',
    '--services',
    'embed',
    '--models',
    modelsDir,
    ...allowRoots.flatMap((root) => ['--allow-root', root]),
  ];
}

const DIMENSIONS = 768;
/** Frames or texts one helper request carries at most. */
const HELPER_BATCH = 16;
/**
 * Requests a call keeps in flight: the helper runs two at a time, so one request's vision pass (GPU) overlaps the
 * other's text pass (Neural Engine). Measured on this M5 Max (vision SPEC): 140-token frames at 13.3 frames/s one
 * at a time, 19.7 two at a time.
 */
const IN_FLIGHT = 2;
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_PREPARE_TIMEOUT_MS = 15 * 60_000;

const vectorsSchema = z.object({ vectors: z.array(z.string()) });

/** A helper failure as a thrown Error: the work queue turns it into `vision.embedding_failed`. */
function failure(method: string, error: TaalcutError): Error {
  return new Error(`${method}: ${helperCode(error)}${error.detail ? ` (${error.detail})` : ''}`);
}

function decode(base64: string): Float32Array {
  const vector = float32sFrom(Buffer.from(base64, 'base64'), DIMENSIONS);
  if (!vector) throw new Error(`a vector of ${Buffer.byteLength(base64, 'base64')} bytes`);
  return vector;
}

async function vectors(
  helper: JsonLineSidecar,
  method: string,
  params: JsonValue,
  count: number,
  timeoutMs: number,
): Promise<Float32Array[]> {
  const result = await helper.request(method, params, { timeoutMs });
  if (!result.ok) throw failure(method, result.error);
  const parsed = vectorsSchema.safeParse(result.value);
  if (!parsed.success || parsed.data.vectors.length !== count) {
    throw new Error(`${method}: expected ${count} vectors`);
  }
  return parsed.data.vectors.map(decode);
}

/** Loads the models in a new helper process (`embed.prepare`), then embeds through it. Throws when they won't load. */
export async function loadCoreMlModel(options: CoreMlModelOptions): Promise<EmbeddingModel> {
  const tokenizer =
    options.tokenizer ??
    (await (
      await importTransformers()
    ).AutoTokenizer.from_pretrained(options.tokenizerDir, { local_files_only: true }));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const helper = options.open();
  // Loads the text functions and the given budgets' vision functions: 2.6–6.3 s once Core ML has compiled them.
  const prepare = (budgets: readonly ImageTokenBudget[] = IMAGE_TOKEN_BUDGETS) =>
    helper.request(
      'embed.prepare',
      { budgets: [...budgets] },
      { timeoutMs: options.prepareTimeoutMs ?? DEFAULT_PREPARE_TIMEOUT_MS },
    );
  const prepared = await prepare();
  if (!prepared.ok) {
    await helper.close();
    throw failure('embed.prepare', prepared.error);
  }

  async function frames(part: readonly EmbeddingImage[], tokens: ImageTokenBudget): Promise<Float32Array[]> {
    const files = part.map((image) => ({ image, path: join(options.tempDir, `eg2-${randomUUID()}.rgb`) }));
    try {
      await Promise.all(files.map(({ image, path }) => writeFile(path, image.rgb)));
      const params = {
        tokens,
        frames: files.map(({ image, path }) => ({ path, width: image.width, height: image.height })),
      };
      return await vectors(helper, 'embed.images', params, part.length, timeoutMs);
    } finally {
      await Promise.all(files.map(({ path }) => rm(path, { force: true })));
    }
  }

  return {
    device: 'coreml',
    async embedTexts(texts) {
      const ids = texts.map((text) =>
        Array.from(
          tokenizer([text], { truncation: true, max_length: MAX_TEXT_TOKENS }).input_ids.data,
          Number,
        ),
      );
      const parts = await Promise.all(
        chunk(ids, HELPER_BATCH).map((part) =>
          vectors(helper, 'embed.texts', { ids: part }, part.length, timeoutMs),
        ),
      );
      return parts.flat();
    },
    async embedImages(images) {
      const tokens = sameBudget(images);
      const size = Math.min(HELPER_BATCH, Math.max(1, Math.ceil(images.length / IN_FLIGHT)));
      const parts = await Promise.all(chunk(images, size).map((part) => frames(part, tokens)));
      return parts.flat();
    },
    async rewarm(imageTokens) {
      // The helper exits after a while idle and starts again at the next request, loading on the first frame's
      // path; an import start sends this first (a quick answer when it is still up). The text functions load
      // shortest first and a request waits only for its own, so a search meanwhile isn't held up by the rest.
      const again = await prepare([imageTokens]);
      if (!again.ok) throw failure('embed.prepare', again.error);
    },
    async dispose() {
      await helper.close();
    },
  };
}
