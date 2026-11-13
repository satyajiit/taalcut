// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Audio indexing's long-lived parts in the jobs process (packages/audio, IX-A1…A6), made on the first indexing
 * job and closed with the container:
 * - the asset audio store: one decode per asset, its speech PCM kept from language ID to the transcript, under
 *   the temp folder's real path (the mac helper resolves symlinks before it checks a root), and each video's
 *   waveform peaks kept for media.previews;
 * - the whisper-server pool: one process per model, on the backend the ASR plan picks from the hardware
 *   profile (Metal on Apple silicon; the CPU, as a logged fallback, elsewhere on a Mac), each with a watchdog
 *   that stops it if this process dies, and each launch written down under userData so the next jobs process
 *   stops (at its start) anything a previous one still left;
 * - Silero VAD, one session per model file;
 * - the Parakeet helper (the mac helper's ASR service over the Core ML model component), one per model folder,
 *   allowed to read the store's folder only.
 */
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createAssetAudioStore,
  createSileroVad,
  type AssetAudioStore,
  type AudioIndexJobDeps,
  type ServerRegistry,
  type SpeechSidecar,
  type VadEngine,
  type WhisperDecoder,
} from '@taalcut/audio';
import { createToken, type Container } from '@taalcut/core';
import type { UtilityConfig } from '../../shared/rpc-ipc';
import { createParakeetHelpers } from './audio-parakeet-helpers';
import { createWhisperServers, sweptWhisperRegistry, type WhisperServersDeps } from './audio-whisper-servers';

export interface AudioIndexingRuntime {
  readonly store: AssetAudioStore;
  /** The persistent decoder over this whisper-server binary. */
  decoder(serverBinary: string): Promise<WhisperDecoder>;
  vad(modelPath: string): VadEngine;
  /** The helper over this Parakeet model folder, or undefined when the helper isn't there (logged once). */
  parakeet(modelsDir: string): Promise<SpeechSidecar | undefined>;
  close(): Promise<void>;
}

export const AudioIndexingToken = createToken<AudioIndexingRuntime>('desktop.audioIndexing');

export type AudioIndexingDeps = WhisperServersDeps;

/** What is installed now for indexing: '' (or undefined) for what isn't. */
export interface AudioIndexingTools {
  readonly server: string;
  readonly vad: string;
  readonly parakeetDir: string | undefined;
}

/** What the indexing kinds add to the jobs' deps, from the tools installed now (looked up per job). */
export async function indexingDeps(
  runtime: AudioIndexingRuntime,
  tools: AudioIndexingTools,
): Promise<Pick<AudioIndexJobDeps, 'store' | 'decoder' | 'vad' | 'sidecar'>> {
  const sidecar = tools.parakeetDir ? await runtime.parakeet(tools.parakeetDir) : undefined;
  return {
    store: runtime.store,
    ...(sidecar ? { sidecar } : {}),
    ...(tools.server ? { decoder: await runtime.decoder(tools.server) } : {}),
    ...(tools.vad ? { vad: runtime.vad(tools.vad) } : {}),
  };
}

/** Silero sessions, one per model file, made on first use. */
function vadsByModel(onFallback: AudioIndexingDeps['onFallback']): (modelPath: string) => VadEngine {
  const vads = new Map<string, VadEngine>();
  return (modelPath) => {
    let vad = vads.get(modelPath);
    if (!vad) {
      vad = createSileroVad({ modelPath, onComputeFallback: onFallback });
      vads.set(modelPath, vad);
    }
    return vad;
  };
}

export function createAudioIndexingRuntime(
  config: UtilityConfig,
  deps: AudioIndexingDeps,
  registry: ServerRegistry = sweptWhisperRegistry(config.userData, deps.log),
): AudioIndexingRuntime {
  const store = createAssetAudioStore({
    parent: join(realpathSync(tmpdir()), 'taalcut-asset-audio'),
    onFallback: deps.onFallback,
    // media.previews draws waveforms from the pass (jobs-root.ts wires the store as media's speech-PCM port).
    keepPeaks: true,
  });
  const servers = createWhisperServers(registry, store.root, deps);
  const helpers = createParakeetHelpers(config, store.root, deps.log);
  return {
    store,
    decoder: async (serverBinary) => (await servers.pool()).decoder(serverBinary),
    vad: vadsByModel(deps.onFallback),
    parakeet: (modelsDir) => helpers.parakeet(modelsDir),
    async close() {
      await Promise.all([servers.close(), helpers.close(), store.close()]);
    },
  };
}

export function registerAudioIndexing(
  container: Container,
  config: UtilityConfig,
  deps: AudioIndexingDeps,
): void {
  // At the process's start: servers a previous jobs process left are stopped now, not when this one first needs
  // whisper, which may be never (IX-F7).
  const registry = sweptWhisperRegistry(config.userData, deps.log);
  container.factory(AudioIndexingToken, () => createAudioIndexingRuntime(config, deps, registry), {
    dispose: (runtime) => runtime.close(),
  });
}
