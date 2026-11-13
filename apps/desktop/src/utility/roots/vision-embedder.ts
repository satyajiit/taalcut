// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The jobs process's embedder (IX-E2…E4): EmbeddingGemma 2 from its
 * component (or the test builds' stand-in), run from this Mac's embedding
 * profile, and warmed when an import starts.
 *
 * The profile is `embeddingProfile` of the probed hardware, tier and
 * accelerators (machine-accelerators.ts: CUDA on the probe's device where
 * CUDA 13 runs, WebGPU where Metal, Vulkan or Direct3D 12 does, the CPU alone
 * under TAALCUT_FORCE_CPU), read once per process so frame sizes don't change
 * under the vector memo; a failed probe gives the Minimum tier's profile.
 *
 * Warm start: when a file is being hashed or normalised, the model loads and
 * runs one frame, so its load is off the path of the first shot detection
 * and frame vectors. Only where the profile keeps the model resident from
 * the start (not the Minimum tier); elsewhere it loads at the first frame.
 *
 * On macOS 15 and later the profile tries Core ML first: the mac helper's
 * embed service (vision-coreml.ts), when its component is installed and
 * compiled for this Mac; otherwise, or when it fails to load (logged), ONNX
 * Runtime on WebGPU.
 */
import type { ComputeFallbackEvent, EventBus, Unsubscribe } from '@taalcut/core';
import { hashAssetJob } from '@taalcut/library';
import { mediaNormaliseJob, type LibrarySearch, type MachineAccelerators } from '@taalcut/media';
import {
  createEmbedder,
  DEFAULT_EMBEDDING_PROFILE,
  EMBEDDING_COMPONENT,
  embeddingProfile,
  type EmbeddingModelLoader,
  type EmbeddingProfile,
  type NativeEmbeddingBackend,
  type VisionEmbedder,
} from '@taalcut/vision';
import type { ProbedHardware } from '../../shared/tokens';
import { probeFailure } from './hardware';

export interface DesktopEmbedderDeps {
  readonly events: EventBus;
  readonly hardware: () => Promise<ProbedHardware>;
  /** The probe's accelerators (machine-accelerators.ts); absent: the platform's row. */
  readonly accelerators?: () => Promise<MachineAccelerators | undefined>;
  /** An installed component's folder, or null. */
  readonly installed: (id: string) => Promise<string | null>;
  readonly onFallback: (event: ComputeFallbackEvent) => void;
  /** Test builds: the stand-in model instead of the component. */
  readonly loader?: EmbeddingModelLoader;
  /** The Core ML model in the mac helper (vision-coreml.ts), tried first where the profile lists `coreml`. */
  readonly coreml?: NativeEmbeddingBackend;
  /** Where a CUDA failure's missing libraries are looked for (machine-accelerators.ts `cudaRuntimeLibraries`). */
  readonly cudaLibraries?: LibrarySearch;
}

export function desktopEmbedder(deps: DesktopEmbedderDeps): VisionEmbedder {
  const profile = async (): Promise<EmbeddingProfile> => {
    try {
      const { info, assessment } = await deps.hardware();
      const accelerators = await deps.accelerators?.();
      return embeddingProfile({ ...info, tier: assessment.tier, ...(accelerators ? { accelerators } : {}) });
    } catch (cause) {
      // The embedder keeps the profile it loads with: the minimum's until the app restarts (IX-F3: say so).
      console.warn(
        `[vision] hardware not probed (${probeFailure(cause)}): the minimum embedding profile until restart`,
      );
      return DEFAULT_EMBEDDING_PROFILE;
    }
  };
  const { onFallback, loader, coreml } = deps;
  const onDeviceFailed = (device: string, detail: string) =>
    console.warn(`[vision] the embedder didn't load on ${device} (${detail}): trying the next device`);
  const log = (line: string) => console.warn(line);
  const embedder = createEmbedder(
    loader
      ? { modelDir: 'stand-in', loader, onFallback, profile, log }
      : {
          modelDir: () => deps.installed(EMBEDDING_COMPONENT),
          onFallback,
          profile,
          onDeviceFailed,
          log,
          ...(coreml ? { native: { coreml } } : {}),
          ...(deps.cudaLibraries ? { cudaLibraries: deps.cudaLibraries } : {}),
        },
  );
  warmEmbedderOnImport(deps.events, embedder);
  // Where Core ML comes first, its load (the first time, a compile for this Mac) starts with the jobs process, so
  // the first import finds it done; the helper exits again when idle.
  if (coreml && !loader) {
    void (async () => {
      if ((await profile()).devices[0] === 'coreml') await coreml.available();
    })();
  }
  return embedder;
}

/** Jobs that mean files are coming in: frames to embed follow within seconds. */
const IMPORT_STARTS: ReadonlySet<string> = new Set([hashAssetJob.kind, mediaNormaliseJob.kind]);

export function warmEmbedderOnImport(
  bus: EventBus,
  embedder: Pick<VisionEmbedder, 'warm' | 'warmsOnImport'>,
): Unsubscribe {
  return bus.on('job.stateChanged', ({ payload }) => {
    if (payload.to !== 'running' || !IMPORT_STARTS.has(payload.kind)) return;
    void (async () => {
      if (await embedder.warmsOnImport()) await embedder.warm();
    })();
  });
}
