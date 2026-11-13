// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The embedder (P2-L9, IX-E2…E6): core's `Embedder` for text, plus frames. It
 * lives in the jobs process and serves two kinds of caller: indexing jobs
 * (frames and stored text) and search queries over IPC, which must not wait
 * behind the GPU queue. Its parts:
 *
 * - profile.ts: how it runs on this machine (soft tokens per frame, execution
 *   providers, call size, warm start), resolved once, before the first frame
 *   is sized or the model loads;
 * - backend.ts: the first device that loads, GPU first (the mac helper's
 *   Core ML model on macOS 15, coreml-model.ts, then ONNX Runtime's
 *   providers), each CPU fallback logged as `compute.fallback` (operation
 *   `vision.embed`);
 * - work-queue.ts: one model call at a time, queries first, frame calls
 *   filled to the token budget across callers;
 * - vector-memo.ts: a frame embedded lately (a shot detection's cut pair) is
 *   not embedded again.
 */
import {
  CancelledError,
  err,
  ok,
  type AsyncResult,
  type ComputeFallbackEvent,
  type Embedder,
  type EmbeddingPurpose,
  type TaalcutError,
} from '@taalcut/core';
import { EmbedderUnavailable, EmbeddingFailed } from '../errors';
import { loadNativeAhead, loadOnBestDevice, ortListedDevices, type BackendDeps } from './backend';
import {
  loadTransformersModel,
  type EmbeddingDevice,
  type EmbeddingImage,
  type EmbeddingModel,
  type EmbeddingModelLoader,
} from './model';
import { DEFAULT_EMBEDDING_PROFILE, type EmbeddingProfile } from './profile';
import {
  budgetOfFrame,
  CALIBRATED_IMAGE_TOKENS,
  EMBEDDING_COMPONENT,
  EMBEDDING_SPACE,
  embeddingFrameSize,
  imageTokens,
  prefixed,
  type ImageTokenBudget,
} from './space';
import { createModelSlot } from './model-slot';
import { createVectorMemo, DEFAULT_MEMO_ENTRIES } from './vector-memo';
import { withVectors } from './with-vectors';
import { createWorkQueue } from './work-queue';

/**
 * What a frame's vector is for (IX2-E1). `index`: stored as a search vector, at this machine's budget
 * (`indexImageTokens`). `calibrated`: compared with another frame's against a distance threshold (shot detection's
 * cut confirmation, the breakdown's cuts), at the budget those thresholds were fitted at (CALIBRATED_IMAGE_TOKENS).
 */
export type FrameUse = 'index' | 'calibrated';

export interface VisionEmbedder extends Embedder {
  /** The size a `width`×`height` picture's frames must be at for `embedImages`, for `use` (default `calibrated`). */
  frameSize(width: number, height: number, use?: FrameUse): Promise<{ width: number; height: number }>;
  /** Soft tokens per frame of the vectors this machine stores (its profile's budget). */
  indexImageTokens(): Promise<ImageTokenBudget>;
  /** Unit vectors, one per frame, in order. Frames must be at a `frameSize`. */
  embedImages(
    images: readonly EmbeddingImage[],
    options?: { readonly signal?: AbortSignal },
  ): AsyncResult<Float32Array[]>;
  /** Loads the model and runs one frame through it, so the first job doesn't pay for either (IX-E4). */
  warm(): Promise<void>;
  /** Whether this machine's profile loads the model as soon as an import starts. */
  warmsOnImport(): Promise<boolean>;
  /** The device once loaded, else null. */
  device(): EmbeddingDevice | null;
  /** Drops the model (frees GPU memory) and the remembered vectors. The next call loads it again. */
  close(): Promise<void>;
}

export interface EmbedderOptions {
  /** The installed component folder, or a lookup (null: not installed). Resolved at first use. */
  readonly modelDir: string | (() => Promise<string | null>);
  /** Default: transformers.js. Tests pass a fake. */
  readonly loader?: EmbeddingModelLoader;
  readonly onFallback?: (event: ComputeFallbackEvent) => void;
  /** Turn acceleration off (diagnostics): the CPU choice is logged as `disabled`. */
  readonly disableGpu?: boolean;
  /** This machine's profile (embeddingProfile of its hardware), or how to get it. Default: the Minimum tier's. */
  readonly profile?: EmbeddingProfile | (() => Promise<EmbeddingProfile>);
  /**
   * The execution providers the runtime lists (null: it can't say). Default: onnxruntime-node's list
   * with the default loader, and every provider with a custom loader (it brings its own runtime).
   */
  readonly listDevices?: () => Promise<readonly EmbeddingDevice[] | null>;
  /** Frames whose vectors are remembered (IX-E5). Default 4,096. */
  readonly memoEntries?: number;
  /** Models outside ONNX Runtime by device (IX2-E5: `coreml`, the mac helper's Core ML model). */
  readonly native?: BackendDeps['native'];
  /** A device in the profile that failed to load before the next was tried (a Core ML model that won't load). */
  readonly onDeviceFailed?: BackendDeps['onDeviceFailed'];
  /** Where a CUDA failure's missing libraries are looked for: the desktop names the installed cuda-runtime-13. */
  readonly cudaLibraries?: BackendDeps['cudaLibraries'];
  /** What went wrong without failing a call (model-slot.ts: a move that threw, a model that wouldn't dispose). */
  readonly log?: (line: string) => void;
}

/** The size the warm-up frame takes: a 16:9 picture, the commonest. */
const WARM_PICTURE = { width: 1920, height: 1080 };

/** What loading the model on a device takes, from the embedder's options. */
function backendDeps(options: EmbedderOptions): BackendDeps {
  return {
    loader: options.loader ?? loadTransformersModel,
    modelOptions: {},
    listDevices: options.listDevices ?? (options.loader ? async () => null : ortListedDevices),
    ...(options.onFallback ? { onFallback: options.onFallback } : {}),
    ...(options.disableGpu ? { disableGpu: true } : {}),
    ...(options.native ? { native: options.native } : {}),
    ...(options.onDeviceFailed ? { onDeviceFailed: options.onDeviceFailed } : {}),
    ...(options.cudaLibraries ? { cudaLibraries: options.cudaLibraries } : {}),
  };
}

export function createEmbedder(options: EmbedderOptions): VisionEmbedder {
  const deps = backendDeps(options);
  const memo = createVectorMemo(options.memoEntries ?? DEFAULT_MEMO_ENTRIES);
  let settings: EmbeddingProfile = DEFAULT_EMBEDDING_PROFILE;
  let resolving: Promise<EmbeddingProfile> | undefined;
  let warming: Promise<void> | undefined;

  function profile(): Promise<EmbeddingProfile> {
    resolving ??= (async () => {
      const source = options.profile;
      try {
        settings = typeof source === 'function' ? await source() : (source ?? DEFAULT_EMBEDDING_PROFILE);
      } catch {
        settings = DEFAULT_EMBEDDING_PROFILE;
      }
      return settings;
    })();
    return resolving;
  }

  async function load(): Promise<EmbeddingModel | TaalcutError> {
    const dir = typeof options.modelDir === 'string' ? options.modelDir : await options.modelDir();
    if (!dir) {
      return EmbedderUnavailable(undefined, { detail: `component ${EMBEDDING_COMPONENT} is not installed` });
    }
    const machine = await profile();
    return loadOnBestDevice(dir, machine.devices, {
      ...deps,
      modelOptions: {
        ...deps.modelOptions,
        ...(machine.cudaDeviceId !== undefined ? { cudaDeviceId: machine.cudaDeviceId } : {}),
      },
      ...(machine.forcedCpu ? { disableGpu: true } : {}),
    });
  }

  const slot = createModelSlot({
    load,
    loadNative: async (current) => loadNativeAhead((await profile()).devices, current, deps),
    native: options.native,
    ...(options.log ? { log: options.log } : {}),
  });

  const queue = createWorkQueue({
    withModel: slot.use,
    limits: () => settings,
    tokensOf: imageTokens,
    budgetOf: budgetOfFrame,
  });

  async function frameSize(width: number, height: number, use: FrameUse = 'calibrated') {
    const tokens = use === 'index' ? (await profile()).imageTokens : CALIBRATED_IMAGE_TOKENS;
    return embeddingFrameSize(width, height, tokens);
  }

  return {
    space: EMBEDDING_SPACE,
    frameSize,
    indexImageTokens: async () => (await profile()).imageTokens,
    async embedTexts(texts, { purpose, signal }: { purpose: EmbeddingPurpose; signal?: AbortSignal }) {
      if (signal?.aborted) return err(CancelledError());
      // Queries are someone waiting at a search box; stored text is indexing.
      return queue.texts(
        texts.map((text) => prefixed(text, purpose)),
        purpose === 'query',
        signal,
      );
    },
    async embedImages(images, embedOptions = {}) {
      const signal = embedOptions.signal;
      if (signal?.aborted) return err(CancelledError());
      const frames = images.map((image) => ({ image, key: memo.key(image) }));
      const found = frames.map(({ key }) => memo.get(key));
      const missing = frames.filter((_, i) => found[i] === undefined);
      const embedded = await queue.images(
        missing.map(({ image }) => image),
        signal,
      );
      if (!embedded.ok) return embedded;
      const fresh = withVectors(missing, embedded.value);
      if (!fresh.ok) return fresh;
      for (const { item, vector } of fresh.value) memo.set(item.key, vector);
      const byKey = new Map(fresh.value.map(({ item, vector }) => [item.key, vector]));
      const vectors = frames.flatMap(({ key }, i) => {
        const vector = found[i] ?? byKey.get(key);
        return vector ? [vector] : [];
      });
      if (vectors.length !== images.length) {
        return err(
          EmbeddingFailed(undefined, { detail: `${images.length} frames gave ${vectors.length} vectors` }),
        );
      }
      return ok(vectors);
    },
    warm() {
      // Once per load, however many imports start: a loaded model is warm already, unless it lives in a helper
      // that exits when idle (Core ML), which an import start brings back before the first frame needs it.
      const loadedModel = slot.current();
      // A rewarm that fails is not this call's error: the next call loads again and reports it.
      if (loadedModel)
        return profile()
          .then((settings) => loadedModel.rewarm?.(settings.imageTokens))
          .catch(() => undefined);
      warming ??= (async () => {
        const size = await frameSize(WARM_PICTURE.width, WARM_PICTURE.height, 'index');
        // Loads the model, and a black frame compiles the image path's GPU kernels; its vector is not kept (nor
        // a load's error: the first job reports that).
        await queue.images([{ ...size, rgb: new Uint8Array(size.width * size.height * 3) }]);
      })().finally(() => {
        warming = undefined;
      });
      return warming;
    },
    warmsOnImport: async () => (await profile()).warmOnImport,
    device: () => slot.current()?.device ?? null,
    async close() {
      memo.clear();
      await slot.drop();
    },
  };
}
