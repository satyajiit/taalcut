// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Vision in the jobs process (packages/vision SPEC, Phase 2): EmbeddingGemma 2
 * from its component, the library's vector index for its space, routed OCR
 * (`planOcrBackends`: on a Mac, Apple Vision through the mac helper for Latin
 * text; elsewhere PP-OCRv5 Latin from `ppocr-v5-latin`; PP-OCRv5 Devanagari
 * from its component everywhere) and vision's job kinds over them. The ONNX
 * sessions run on the devices the hardware probe allows (machine-accelerators.ts:
 * CUDA on the probe's device, WebGPU, the CPU; only the CPU, `disabled`, under
 * TAALCUT_FORCE_CPU). Nothing loads at start but the OCR helper's warm-up
 * (vision-ocr-warm.ts, from the jobs process's entry) and the Core ML
 * embedder's first load after it: the
 * model, the PP-OCR sessions and the other helpers open at the first job or
 * search, and a missing component is looked up again next time. The embedder runs from
 * this Mac's embedding profile (tokens per frame, execution providers, call
 * size), and on Recommended and High Macs loads as soon as an import starts
 * (vision-embedder.ts).
 *
 * Indexing reads each asset's video once (IX-D2): vision's jobs share a
 * per-asset frame cache (cleared at start, swept when idle, an asset's
 * entry dropped when its indexing completes), and one tone-map choice per
 * process, so an HDR file doesn't run the tone-map trial on every call.
 *
 * CPU fallbacks go on the event bus as `compute.fallback` (ADR 0002). Shot
 * descriptions go to the agent's background models through main (core's
 * BackgroundModels): on this Mac's model by default, to the cloud only under
 * a standing upload consent; without a port to main they are skipped
 * (`not_yet`). A description on this Mac whose runtime isn't ready (paused
 * for an export, still starting) is held for its model and tried again
 * (LIB1-FIX), never stored as `not_yet`.
 */
import { mkdtemp, realpath } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  EmbedderToken,
  EmbeddingIndexToken,
  err,
  EventBusToken,
  ok,
  SettingsStoreToken,
  type AsyncResult,
  type BackgroundModels,
  type ComputeFallbackEvent,
  type Container,
  type JobRegistration,
  type VectorIndex,
} from '@taalcut/core';
import type { ComponentManager } from '@taalcut/jobs';
import { openVectorIndex } from '@taalcut/library';
import { createJsonLineSidecar, ToneMapSelection, type MediaService } from '@taalcut/media';
import {
  createAppleVisionOcr,
  createLazyVisionJobs,
  createOrtRuntime,
  createPaddleOcr,
  createRoutedOcr,
  EMBEDDING_SPACE,
  lazyOcrEngine,
  VisionModelMissing,
  PADDLE_DEVANAGARI,
  planOcrBackends,
  shotsServeArgs,
  type EmbeddingModelLoader,
  type OcrEngine,
  type PaddleModel,
  type Tier,
  type LookJobDeps,
  type ModelChannel,
  type VisionEmbedder,
} from '@taalcut/vision';
import { hostPlatform } from '../../platform';
import type { UtilityConfig } from '../../shared/rpc-ipc';
import { LibraryDatabaseToken } from '../../shared/tokens';
import { macHardware, probeFailure } from './hardware';
import { sessionContext } from './hardware-sessions';
import { pruneHelperBuildCaches, processAlive } from './helper-build-caches';
import { describerModel } from './index-stages';
import { macHelperResolver } from './mac-helper-resolver';
import { componentsRoot, cudaRuntimeLibraries, probedAccelerators } from './machine-accelerators';
import { coreMlEmbedBackend } from './vision-coreml';
import { ocrWarmUp } from './vision-ocr-warm';
import { desktopBoundaryModel } from './vision-cuts';
import { visionDecodeService } from './vision-decode';
import { desktopEmbedder } from './vision-embedder';
import { indexFrameCache } from './vision-frames';

/** The helper exits after this long without a request. */
const HELPER_IDLE_MS = 120_000;

export interface VisionOptions {
  /** Test builds only: the embedding model's stand-in (shared/standin-embeddings.ts), no component needed. */
  readonly embeddingLoader?: EmbeddingModelLoader;
  /** Present when the jobs process has a derived-file cache. Absent in tests that pass their own jobs. */
  readonly look?: LookJobDeps;
  /** A derived file's path by key (the proxy), when the jobs process has a derived-file cache. */
  readonly derivedPath?: (key: string) => string | undefined;
  /** Stores an asset's Set-of-Mark contact sheet JPEG in the media cache (`vision.indexContactSheet`). */
  readonly storeSheet?: (key: string, body: Buffer) => AsyncResult<{ readonly bytes: number }>;
  /** A new shot-boundary model process's port (jobs.ts asks main); absent: scdet decides shots. */
  readonly shotModel?: () => AsyncResult<ModelChannel>;
  /** The jobs process's entry: start the OCR helper's warm-up now (vision-ocr-warm.ts). Tests leave it off. */
  readonly warmOcrAtStart?: boolean;
}

export interface VisionWiring {
  readonly embedder: VisionEmbedder;
  readonly jobs: readonly JobRegistration[];
  /** The routed OCR (Apple Vision, PP-OCR for Devanagari), for the templates breakdown too. */
  readonly ocr: OcrEngine;
  /** `compute.fallback` on this process's bus. */
  readonly onFallback: (event: ComputeFallbackEvent) => void;
}

export function composeVision(
  container: Container,
  config: UtilityConfig,
  media: MediaService,
  components: () => ComponentManager,
  /** The agent's models over main, for shot descriptions. */
  background?: BackgroundModels,
  options: VisionOptions = {},
): VisionWiring {
  const events = container.resolve(EventBusToken);
  const onFallback = (event: ComputeFallbackEvent) => events.emit('compute.fallback', event);
  const installed = async (id: string) => (await components().get(id))?.path ?? null;

  const hardware = macHardware(config.userData);
  const tier = async (): Promise<Tier> => {
    try {
      return (await hardware()).assessment.tier;
    } catch (cause) {
      // Vision's jobs keep the tier they start with: the minimum until the app restarts (IX-F3: say so).
      console.warn(`[vision] hardware not probed (${probeFailure(cause)}): the minimum tier until restart`);
      return 'minimum';
    }
  };
  // The helper may read only this folder; it resolves symlinks first (/var is /private/var).
  let temp: Promise<string> | undefined;
  const tempDir = () => (temp ??= mkdtemp(join(tmpdir(), 'taalcut-vision-')).then((dir) => realpath(dir)));

  const accelerators = probedAccelerators(hardware);
  const cudaLibraries = cudaRuntimeLibraries(componentsRoot(config.userData));

  const helper = macHelperResolver(config);
  const appleVision = lazyOcrEngine(async () => {
    const found = await helper.resolve();
    if (!found.ok) return found;
    const dir = await tempDir();
    const sidecar = createJsonLineSidecar({
      command: found.value.path,
      args: ['serve', '--services', 'ocr,image', '--allow-root', dir],
      idleExitMs: HELPER_IDLE_MS,
    });
    return ok(createAppleVisionOcr(sidecar, { tempDir: dir }));
  }, 'en');
  // The helper ships inside every Mac build: planOcrBackends takes Apple Vision for Latin on a Mac only, and the
  // devices are the probe's.
  const host = { platform: hostPlatform().name, helper: true };
  const paddle = (model: PaddleModel, language: string) =>
    lazyOcrEngine(async () => {
      const modelDir = await installed(model.component);
      // Not the file's fault: the library holds vision.ocr until the model installs (UX3-IDX).
      if (!modelDir)
        return err(
          VisionModelMissing(
            { component: model.component },
            { detail: `${model.component} is not installed` },
          ),
        );
      const machine = await accelerators();
      const plan = planOcrBackends({ ...host, ...(machine ? { accelerators: machine } : {}) });
      const onnx = createOrtRuntime({
        devices: plan.ortDevices,
        ...(plan.disableGpu ? { disableGpu: true } : {}),
        ...(machine?.cudaDeviceId !== undefined ? { cuda: { deviceId: machine.cudaDeviceId } } : {}),
        cudaLibraries,
        onFallback,
      });
      return ok(createPaddleOcr({ onnx, modelDir, model }));
    }, language);
  const latin = planOcrBackends(host).latin;
  const devanagari = paddle(PADDLE_DEVANAGARI, 'hi');
  const ocr = createRoutedOcr(
    latin === 'apple-vision'
      ? { vision: appleVision, devanagari }
      : { latin: paddle(latin, 'en'), devanagari },
  );
  // FIX-OCRCOLD: the OCR helper starts with the process and compiles Vision's models in the background (its warm-up),
  // and the Core ML embedder's first compile waits for it, so a breakdown's first text read never queues behind it.
  const warmOcr =
    latin === 'apple-vision'
      ? ocrWarmUp(
          appleVision,
          (line) => console.warn(line),
          (keep) =>
            pruneHelperBuildCaches({
              caches: join(homedir(), 'Library', 'Caches'),
              ...(keep ? { keep } : {}),
              now: Date.now,
              alive: processAlive,
            }),
        )
      : undefined;
  if (options.warmOcrAtStart) void warmOcr?.();

  const embedder = desktopEmbedder({
    events,
    hardware,
    accelerators,
    installed,
    onFallback,
    cudaLibraries,
    ...(options.embeddingLoader
      ? { loader: options.embeddingLoader }
      : {
          coreml: coreMlEmbedBackend({
            config,
            installed,
            tempDir,
            log: (line) => console.warn(line),
            ...(warmOcr ? { yieldTo: warmOcr } : {}),
          }),
        }),
  });
  container.value(EmbedderToken, embedder);
  // The jobs connection loads sqlite-vec (library-database.ts); without the extension this throws and
  // embedding jobs fail with that reason, while everything else indexes.
  if (!container.has(EmbeddingIndexToken))
    container.factory(
      EmbeddingIndexToken,
      ({ db }) => {
        const index = openVectorIndex(db, {
          name: EMBEDDING_SPACE.indexName,
          dimensions: EMBEDDING_SPACE.dimensions,
        });
        if (!index.ok)
          throw new Error(`Can't open the vector index: ${index.error.code}`, { cause: index.error });
        return index.value;
      },
      { deps: { db: LibraryDatabaseToken } },
    );
  let indexWarned = false;
  const vectorIndex = (): VectorIndex | undefined => {
    try {
      return container.resolve(EmbeddingIndexToken);
    } catch (cause) {
      if (!indexWarned) console.warn(`[vision] no vector index: ${String(cause)}`);
      indexWarned = true;
      return undefined;
    }
  };

  const boundaryModel = desktopBoundaryModel({
    installed,
    onFallback,
    accelerators,
    start: options.shotModel,
    // TransNetV2 on Core ML (IX2-S10): the helper's shots service, its own process over the component's folder;
    // windows go through the vision temp folder.
    helper: {
      windowsDir: tempDir,
      start: async (modelsDir, windowsDir) => {
        const found = await helper.resolve();
        if (!found.ok) return found;
        return ok(
          createJsonLineSidecar({ command: found.value.path, args: shotsServeArgs(modelsDir, windowsDir) }),
        );
      },
    },
    log: (line) => console.warn(line),
  });
  const frames = indexFrameCache(config.userData, events);
  // The analysis pass and the frame reads decode in the mac helper where there is one, unless switched (IX2-F14,
  // IX3-R2, vision-decode.ts). Opened once, while the process starts; the jobs wait for it.
  const decodeServiceOpened = visionDecodeService(container, config);
  const toneMaps = new ToneMapSelection();

  const jobs = createLazyVisionJobs(async () => {
    const binaries = await media.binaries();
    if (!binaries.ok) return binaries;
    await frames.ready;
    const index = vectorIndex();
    const assessed = await tier();
    const describe = describerModel(assessed);
    const decodeService = await decodeServiceOpened;
    return ok({
      media: { binaries: binaries.value, toneMaps, ...sessionContext(container) },
      frameCache: frames.cache,
      ...(decodeService ? { decodeService } : {}),
      ...(options.derivedPath ? { derivedPath: options.derivedPath } : {}),
      ...(options.storeSheet ? { storeSheet: options.storeSheet } : {}),
      tier: assessed,
      // A long video's analysis in two decodes at once where the video budget has two (IX-D7).
      passParallel: assessed === 'minimum' ? 1 : 2,
      embedder,
      boundaryModel,
      ...(index ? { index } : {}),
      ocr,
      ...(background ? { background } : {}),
      // A description on this Mac whose runtime isn't ready waits for it instead of storing `not_yet` (LIB1-FIX).
      ...(background && describe ? { describeComponent: describe } : {}),
      settings: container.resolve(SettingsStoreToken),
      tempDir: await tempDir(),
      onFallback,
      ...(options.look ? { look: { ...options.look, onFallback } } : {}),
    });
  });
  return { embedder, jobs, ocr, onFallback };
}
