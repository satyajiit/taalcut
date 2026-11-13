// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `audio.analyzeSpeech` in the jobs process (packages/audio SPEC P3.7): Silero VAD from the `silero-vad`
 * component (WebGPU first, the CPU provider with one logged fallback), the asset's file, content hash and stored
 * transcript from the library, and the analysis cached as derived JSON in media's cache. Nothing loads at start:
 * each job looks the component up again, so one installed after launch is used by the next job, and a missing one
 * fails the job with `audio.model_missing` naming it.
 */
import { err, type ComputeFallbackEvent, type Container, type JobRegistration } from '@taalcut/core';
import {
  createCleanupJobs,
  createSileroVad,
  createSpeechCleanupAnalyser,
  ModelMissing,
  type SpeechCleanupAnalyser,
  type VadEngine,
} from '@taalcut/audio';
import type { DerivedCache, MediaService } from '@taalcut/media';
import type { UtilityConfig } from '../../shared/rpc-ipc';
import { sessionContext } from './hardware-sessions';
import { cacheJson, installedComponentFile, librarySpeechAssets } from './audio-library';

export const SILERO_COMPONENT = { id: 'silero-vad', file: 'silero_vad.onnx' } as const;

/** The analyser over the component installed now; one VAD session per model file. */
function componentAnalyser(
  container: Container,
  config: UtilityConfig,
  media: MediaService,
  onFallback: (event: ComputeFallbackEvent) => void,
): SpeechCleanupAnalyser {
  const engines = new Map<string, VadEngine>();
  return {
    async analyse(request) {
      const modelPath = installedComponentFile(config.userData, SILERO_COMPONENT.id, SILERO_COMPONENT.file);
      if (!modelPath) return err(ModelMissing({ component: SILERO_COMPONENT.id }));
      const binaries = await media.binaries();
      if (!binaries.ok) return binaries;
      let vad = engines.get(modelPath);
      if (!vad) {
        vad = createSileroVad({ modelPath, onComputeFallback: onFallback });
        engines.set(modelPath, vad);
      }
      const analyser = createSpeechCleanupAnalyser({
        vad,
        media: { binaries: binaries.value, ...sessionContext(container) },
      });
      return analyser.analyse(request);
    },
  };
}

export function cleanupJobs(
  container: Container,
  config: UtilityConfig,
  media: MediaService,
  cache: DerivedCache,
  onFallback: (event: ComputeFallbackEvent) => void,
): readonly JobRegistration[] {
  return createCleanupJobs({
    assets: librarySpeechAssets(container),
    derived: cacheJson(() => cache),
    analyser: componentAnalyser(container, config, media, onFallback),
  });
}
