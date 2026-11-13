// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EmbeddingGemma 2 q4 (text and vision graphs, no audio; the vision graph as q4f16) on transformers.js
 * 4.3.1 and onnxruntime-node 1.30.0, loaded only from the component folder:
 * remote models off, local files only, so nothing can be fetched. The call
 * is the one spike 02 measured: AutoConfig with `audio_config = null`, then
 * AutoModel with per-file q4 dtypes and the ORT execution provider list.
 * transformers loads lazily, so importing vision doesn't map ONNX Runtime.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { budgetOfFrame, type ImageTokenBudget } from './space';

export interface EmbeddingImage {
  /** Exactly `embeddingFrameSize` of the source at one image-token budget (the size says which). */
  readonly width: number;
  readonly height: number;
  /** rgb24, row-major. */
  readonly rgb: Uint8Array;
}

/**
 * Where the model can run, by core's compute-backend names: ONNX Runtime's execution providers, except `coreml`,
 * which is the mac helper's Core ML model (coreml-model.ts, IX2-E5), never ONNX Runtime's Core ML provider.
 */
export const EMBEDDING_DEVICES = ['webgpu', 'coreml', 'directml', 'cuda', 'cpu'] as const;
export type EmbeddingDevice = (typeof EMBEDDING_DEVICES)[number];

/**
 * The vision encoder's graph. q4f16 is the q4 weights with fp16 activations: on WebGPU it ran 1.7–2.2×
 * faster than q4 with the same vectors (cosine 1.0000) and the same search scores (IX-E2), so the
 * component ships it; a folder installed before has only q4, which still loads. fp16 is study-only.
 */
export const VISION_ENCODER_DTYPES = ['q4', 'q4f16', 'fp16'] as const;
export type VisionEncoderDtype = (typeof VISION_ENCODER_DTYPES)[number];

/** The given dtype, else q4f16 when the folder has its graph, else q4. */
export function visionDtypeFor(modelDir: string, wanted?: VisionEncoderDtype): VisionEncoderDtype {
  if (wanted) return wanted;
  return existsSync(join(modelDir, 'onnx', 'vision_encoder_q4f16.onnx')) ? 'q4f16' : 'q4';
}

export interface EmbeddingModelOptions {
  /** Default: `visionDtypeFor` the folder. Any other needs its graph in the folder's `onnx/`. */
  readonly visionDtype?: VisionEncoderDtype;
  /** The CUDA session's device id (the probe's CUDA ordinal); unset: ORT's default, device 0. */
  readonly cudaDeviceId?: number;
}

/** A loaded model on one device. Not re-entrant: the embedder runs one batch at a time. */
export interface EmbeddingModel {
  readonly device: EmbeddingDevice;
  /** Texts already prefixed. One row per text, 768 wide, in order. */
  embedTexts(texts: readonly string[]): Promise<Float32Array[]>;
  /** Frames of one budget (`sameBudget`), each at its processor size. */
  embedImages(images: readonly EmbeddingImage[]): Promise<Float32Array[]>;
  /**
   * Brings a model that lives in another process back after that process exited idle (the Core ML helper): its text
   * model and the image model of `imageTokens` (the index budget), the parts an import uses (IX3-N4).
   */
  rewarm?(imageTokens: ImageTokenBudget): Promise<void>;
  dispose(): Promise<void>;
}

export type EmbeddingModelLoader = (
  modelDir: string,
  device: EmbeddingDevice,
  options?: EmbeddingModelOptions,
) => Promise<EmbeddingModel>;

interface Tensor {
  readonly dims: readonly number[];
  readonly data: ArrayLike<number>;
}

export interface Transformers {
  readonly env: { allowRemoteModels: boolean; allowLocalModels: boolean; localModelPath: string };
  readonly AutoConfig: { from_pretrained(dir: string, options: object): Promise<Record<string, unknown>> };
  readonly AutoModel: {
    from_pretrained(
      dir: string,
      options: object,
    ): Promise<((inputs: object) => Promise<Record<string, Tensor>>) & { dispose?(): Promise<unknown> }>;
  };
  readonly AutoProcessor: {
    from_pretrained(dir: string, options: object): Promise<Processor>;
  };
  readonly AutoTokenizer: {
    from_pretrained(dir: string, options: object): Promise<Tokenizer>;
  };
  readonly RawImage: new (
    data: Uint8ClampedArray,
    width: number,
    height: number,
    channels: number,
  ) => unknown;
}

/** The tokenizer alone: token ids with `<bos>` and `<eos>`, as the processor makes them for text. */
export type Tokenizer = (
  texts: string[],
  options: { readonly truncation: boolean; readonly max_length: number },
) => { readonly input_ids: { readonly data: ArrayLike<bigint | number> } };

/** The processor: callable, with the image processor whose budget sets each frame's soft tokens. */
type Processor = ((...args: unknown[]) => Promise<object>) & {
  readonly image_processor?: { max_soft_tokens: number };
};

/** transformers.js's names for the execution providers (`dml` for DirectML). */
const TRANSFORMERS_DEVICE: Readonly<Record<EmbeddingDevice, string>> = {
  webgpu: 'webgpu',
  coreml: 'coreml',
  directml: 'dml',
  cuda: 'cuda',
  cpu: 'cpu',
};

/** The provider list for one device: CUDA with the probe's device id, the others by name. */
export function sessionProviders(
  device: EmbeddingDevice,
  options: EmbeddingModelOptions = {},
): (string | { readonly name: string; readonly deviceId: number })[] {
  const provider = TRANSFORMERS_DEVICE[device];
  return device === 'cuda' && options.cudaDeviceId !== undefined
    ? [{ name: provider, deviceId: options.cudaDeviceId }]
    : [provider];
}

const MODULE = '@huggingface/transformers';
const DIMENSIONS = 768;
/** Text length cap in tokens: far above a transcript segment, well under the 8,192 context. */
export const MAX_TEXT_TOKENS = 2048;

/** transformers.js with remote models off: weights and tokenizers only from component folders. */
export async function importTransformers(): Promise<Transformers> {
  const module = (await import(MODULE)) as unknown as Transformers;
  // Weights come only from the checksummed component folder; nothing is ever downloaded.
  module.env.allowRemoteModels = false;
  module.env.allowLocalModels = true;
  module.env.localModelPath = '';
  return module;
}

function rows(tensor: Tensor | undefined): Float32Array[] {
  if (!tensor || tensor.dims[tensor.dims.length - 1] !== DIMENSIONS) {
    throw new Error(
      `expected sentence_embedding [n, ${DIMENSIONS}], got ${tensor ? tensor.dims.join('x') : 'none'}`,
    );
  }
  const count = tensor.data.length / DIMENSIONS;
  const out: Float32Array[] = [];
  for (let i = 0; i < count; i++) {
    const row = new Float32Array(DIMENSIONS);
    for (let j = 0; j < DIMENSIONS; j++) row[j] = tensor.data[i * DIMENSIONS + j] ?? 0;
    out.push(row);
  }
  return out;
}

/** The one budget every frame of a call was sized for; throws when they differ or a size fits none. */
export function sameBudget(images: readonly EmbeddingImage[]): ImageTokenBudget {
  const budgets = new Set(images.map((image) => budgetOfFrame(image)));
  const [budget] = budgets;
  if (budgets.size !== 1 || budget === undefined) {
    const sizes = images.map((image) => `${image.width}x${image.height}`).join(', ');
    throw new Error(`frames of one call must be sized for one image-token budget, got ${sizes}`);
  }
  return budget;
}

export const loadTransformersModel: EmbeddingModelLoader = async (modelDir, device, loadOptions = {}) => {
  const tf = await importTransformers();
  const options = { local_files_only: true };
  const config = await tf.AutoConfig.from_pretrained(modelDir, options);
  // The audio encoder is not shipped; without this transformers would look for it.
  config['audio_config'] = null;
  const provider = TRANSFORMERS_DEVICE[device];
  const model = await tf.AutoModel.from_pretrained(modelDir, {
    ...options,
    config,
    device: provider,
    dtype: { model: 'q4', vision_encoder: visionDtypeFor(modelDir, loadOptions.visionDtype) },
    session_options: { executionProviders: sessionProviders(device, loadOptions), logSeverityLevel: 3 },
  });
  const processor = await tf.AutoProcessor.from_pretrained(modelDir, options);
  const imageProcessor = processor.image_processor;
  if (!imageProcessor) throw new Error('the processor has no image processor');
  return {
    device,
    async embedTexts(texts) {
      const inputs = await processor([...texts], null, null, null, {
        padding: true,
        truncation: true,
        max_length: MAX_TEXT_TOKENS,
      });
      return rows((await model(inputs))['sentence_embedding']);
    },
    async embedImages(images) {
      // The budget sets both the resize target (none: frames come at it) and the padded patch count the vision
      // encoder runs on, so it follows the call's frames (IX2-E1).
      imageProcessor.max_soft_tokens = sameBudget(images);
      // One sample per image: a flat list would be one interleaved input.
      const nested = images.map((image) => [
        new tf.RawImage(
          new Uint8ClampedArray(image.rgb.buffer, image.rgb.byteOffset, image.rgb.byteLength),
          image.width,
          image.height,
          3,
        ),
      ]);
      return rows((await model(await processor(null, nested)))['sentence_embedding']);
    },
    async dispose() {
      await model.dispose?.();
    },
  };
};
