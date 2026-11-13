// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Audio in the jobs process (packages/audio SPEC): whisper.cpp (language id
 * and transcripts on Metal) and Beat This! on ONNX Runtime, all from their
 * components, and audio's job kinds over them, the indexing kinds included.
 * Nothing loads at start: each job looks its binaries and models up again, so
 * a component installed after launch is used by the next job, and a missing
 * one fails that job with `audio.model_missing` naming it (the stage can be
 * retried once it is installed).
 *
 * Indexing (IX) also uses the long-lived parts in audio-indexing.ts: the
 * asset audio store, whisper-server (one process per model, from the build
 * the ASR plan picks among those installed: `whisper-server-cuda` on Linux
 * NVIDIA, else `whisper-server`; whisper-cli per call otherwise), Silero VAD (when
 * `silero-vad` is installed) and Parakeet on the Neural Engine, whenever its
 * Core ML model component is installed and the mac helper is there (every
 * language goes to whisper on Metal otherwise). The jobs process has no cloud
 * speech: background indexing never uploads audio. Phase 3 adds the speech
 * cleanup analysis (audio-cleanup-jobs.ts); EAR1 adds listening (audio-listen.ts).
 */
import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  err,
  EventBusToken,
  SettingsStoreToken,
  type ComputeFallbackEvent,
  type Container,
  type JobHandler,
  type JobRegistration,
} from '@taalcut/core';
import {
  ASR_BACKENDS,
  audioIndexJobKinds,
  createAudioIndexJobs,
  createAudioJobs,
  createOrtBeatRuntime,
  audioDetectLanguageJob,
  audioMeasureJob,
  audioTrackBeatsJob,
  audioTranscribeCloudJob,
  audioTranscribeParakeetJob,
  audioTranscribeWhisperJob,
  ModelMissing,
  type AudioIndexJobDeps,
  type AudioJobDeps,
  type HardwareTier,
} from '@taalcut/audio';
import type { ComponentManager } from '@taalcut/jobs';
import type { DerivedCache, MediaService } from '@taalcut/media';
import type { UtilityConfig } from '../../shared/rpc-ipc';
import type { ProbedHardware } from '../../shared/tokens';
import { cleanupJobs, SILERO_COMPONENT } from './audio-cleanup-jobs';
import { composeListen } from './audio-listen';
import {
  AudioIndexingToken,
  indexingDeps,
  registerAudioIndexing,
  type AudioIndexingTools,
} from './audio-indexing';
import { spokenLanguageDeps } from './audio-spoken-languages';
import { plannedServer, type WhisperServersDeps } from './audio-whisper-servers';
import { managedNativesOnly } from './dev-components';
import { macHardware, probeFailure } from './hardware';
import { sessionContext } from './hardware-sessions';
import { componentsRoot, machineBeatPlan, sidecarAcceleratorEnv } from './machine-accelerators';

/** Component ids (tools/components) and the file each one installs. */
export const AUDIO_COMPONENTS = {
  whisperCli: { id: 'whisper-cpp', file: 'whisper-cli' },
  tiny: { id: 'whisper-tiny', file: 'ggml-tiny.bin' },
  small: { id: 'whisper-small-q8-0', file: 'ggml-small-q8_0.bin' },
  medium: { id: 'whisper-medium-q5-0', file: 'ggml-medium-q5_0.bin' },
  beats: { id: 'beat-this' },
  /**
   * whisper.cpp's server, built with whisper-cli: the model loaded once per jobs process (IX-A3). Its GPU builds
   * (`whisper-server-cuda`, ASR_BACKENDS) install the same file; the ASR plan picks the build.
   */
  whisperServer: { id: 'whisper-server', file: 'whisper-server' },
  /** Parakeet TDT 0.6B v3 int8 for Core ML: the mac helper's `--models` folder. */
  parakeet: { id: 'parakeet-tdt-0-6b-v3-coreml' },
} as const;

/** A checkout's own whisper build (tools/whisper/build.sh), for development runs without the component. */
const DEV_WHISPER = fileURLToPath(new URL('../../../../tools/whisper/dist/whisper-cli', import.meta.url));
const DEV_WHISPER_SERVER = fileURLToPath(
  new URL('../../../../tools/whisper/dist/whisper-server', import.meta.url),
);

async function executable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

const ALL_KINDS = [
  audioMeasureJob,
  audioDetectLanguageJob,
  audioTranscribeParakeetJob,
  audioTranscribeWhisperJob,
  audioTranscribeCloudJob,
  audioTrackBeatsJob,
  ...audioIndexJobKinds,
];

export function composeAudio(
  container: Container,
  config: UtilityConfig,
  media: MediaService,
  components: () => ComponentManager,
  cache?: DerivedCache,
): { readonly jobs: readonly JobRegistration[] } {
  const events = container.resolve(EventBusToken);
  const onFallback = (event: ComputeFallbackEvent) => events.emit('compute.fallback', event);
  const log = (message: string) => console.warn(message);
  const hardware = macHardware(config.userData);
  const root = componentsRoot(config.userData);
  // One ORT runtime for the process: sessions open on demand, on the probe's devices (CUDA, WebGPU, the CPU).
  const beatsOnnx = createOrtBeatRuntime(onFallback, machineBeatPlan(hardware, root, log));

  // A checkout's own whisper builds stand in for the components, unless runtimes come from components only.
  const managedOnly = managedNativesOnly(config.packaged);
  const { installed, whisperTool } = componentFiles(components, managedOnly, log);
  const whisper = { ...whisperMachine(hardware, installed, log), sidecarEnv: sidecarAcceleratorEnv(root) };
  registerAudioIndexing(container, config, { ...whisper, onFallback, log });
  // LIB1-LANG: the person's languages and, when they need it, the Indian-language identifier.
  const spoken = spokenLanguageDeps(container.resolve(SettingsStoreToken), components, onFallback);
  const tier = async (): Promise<HardwareTier> => {
    try {
      return (await hardware()).assessment.tier;
    } catch {
      return 'minimum';
    }
  };

  const resolve = async () => {
    const binaries = await media.binaries();
    if (!binaries.ok) return binaries;
    const [binary, tiny, small, medium, beats, hardwareTier, tools] = await Promise.all([
      whisperTool(AUDIO_COMPONENTS.whisperCli, DEV_WHISPER),
      installed(AUDIO_COMPONENTS.tiny.id, AUDIO_COMPONENTS.tiny.file),
      installed(AUDIO_COMPONENTS.small.id, AUDIO_COMPONENTS.small.file),
      installed(AUDIO_COMPONENTS.medium.id, AUDIO_COMPONENTS.medium.file),
      components().get(AUDIO_COMPONENTS.beats.id),
      tier(),
      indexingTools(components, installed, whisper, managedOnly, log),
    ]);
    const deps: AudioIndexJobDeps = {
      media: { binaries: binaries.value, ...sessionContext(container) },
      // Background indexing never uploads: no cloud speech here, so no consent is ever read.
      settings: { hasSpeechUploadConsent: () => false, localOnly: () => true, tier: () => hardwareTier },
      whisper: { binary, tiny, small, medium },
      beats: { onnx: beatsOnnx, modelDir: beats?.path ?? '' },
      onFallback,
      log,
      ...(await indexingDeps(container.resolve(AudioIndexingToken), tools)),
      ...(await spoken()),
    };
    return { ok: true as const, value: deps };
  };

  const handlers = async () => {
    const deps = await resolve();
    if (!deps.ok) return deps;
    const missing = missingComponent(deps.value);
    const map = new Map<string, JobHandler<unknown, unknown>>();
    for (const { kind, handler } of [...createAudioJobs(deps.value), ...createAudioIndexJobs(deps.value)])
      map.set(kind.kind, handler);
    return { ok: true as const, value: { map, missing } };
  };

  const jobs = ALL_KINDS.map((kind) => ({
    kind: kind as JobRegistration['kind'],
    handler: (async (input, context) => {
      const ready = await handlers();
      if (!ready.ok) return ready;
      const missing = ready.value.missing(kind.kind);
      if (missing) return err(missing);
      return ready.value.map.get(kind.kind)!(input, context);
    }) as JobHandler<unknown, unknown>,
  }));
  // EAR1: listening (`audio.listen.analyse`, `audio.listen.query`) over the listen components (audio-listen.ts).
  const listen = composeListen(container, config, {
    media,
    components,
    ...(cache ? { cache } : {}),
    hardware,
    log,
  });
  // P3-V9: the speech cleanup analysis, over the Silero component and media's cache (audio-cleanup-jobs.ts).
  return {
    jobs: [
      ...jobs,
      ...(cache ? cleanupJobs(container, config, media, cache, onFallback) : []),
      ...listen.jobs,
    ],
  };
}

/** A checkout's whisper build, when it stands in for the component: said once per binary (UX3-IDX). */
const usedDevBuild = new Set<string>();
async function devBuild(path: string, log: (message: string) => void): Promise<string> {
  if (!(await executable(path))) return '';
  if (!usedDevBuild.has(path)) log(`[components] ${path}: a development run's whisper build (no component)`);
  usedDevBuild.add(path);
  return path;
}

/**
 * Component lookups, per job: `<install dir>/<file>` or ''; a whisper binary falls back to a checkout's build unless
 * runtimes come from components only (`managedOnly`: a packaged app, or a run installing from a local release).
 */
function componentFiles(
  components: () => ComponentManager,
  managedOnly: boolean,
  log: (message: string) => void,
) {
  const installed = async (id: string, file: string) => {
    const found = await components().get(id);
    return found ? join(found.path, file) : '';
  };
  const whisperTool = async (component: { id: string; file: string }, dev: string) => {
    const found = await installed(component.id, component.file);
    if (found) return found;
    return managedOnly ? '' : devBuild(dev, log);
  };
  return { installed, whisperTool };
}

/**
 * The indexing tools installed now: the planned build's whisper-server (a checkout's own build in development),
 * Silero and the Parakeet model.
 */
async function indexingTools(
  components: () => ComponentManager,
  installed: ReturnType<typeof componentFiles>['installed'],
  whisper: Pick<WhisperServersDeps, 'backends' | 'forcedCpu' | 'builds'>,
  managedOnly: boolean,
  log: (message: string) => void,
): Promise<AudioIndexingTools> {
  const [planned, vad, parakeet] = await Promise.all([
    plannedServer(whisper),
    installed(SILERO_COMPONENT.id, SILERO_COMPONENT.file),
    components().get(AUDIO_COMPONENTS.parakeet.id),
  ]);
  const server = planned ?? (managedOnly ? '' : await devBuild(DEV_WHISPER_SERVER, log));
  return { server, vad, parakeetDir: parakeet?.path };
}

/**
 * What the ASR plan reads: the hardware profile's backends (on a failed probe the CPU alone, said once; whisper-server
 * then says it fell back), the forced CPU, and the whisper-server builds installed now.
 */
function whisperMachine(
  hardware: () => Promise<ProbedHardware>,
  installed: ReturnType<typeof componentFiles>['installed'],
  log: (message: string) => void,
): Pick<WhisperServersDeps, 'backends' | 'forcedCpu' | 'builds'> {
  let warned = false;
  const ids = [...new Set(ASR_BACKENDS.whisper.map((option) => option.component))];
  return {
    backends: async () => {
      try {
        return (await hardware()).assessment.compute.backends;
      } catch (cause) {
        if (!warned)
          log(`[audio] hardware probe failed (${probeFailure(cause)}); whisper-server starts on the CPU`);
        warned = true;
        return ['cpu'] as const;
      }
    },
    forcedCpu: async () => (await hardware().catch(() => undefined))?.info.forcedCpu ?? false,
    builds: async () => {
      const found = await Promise.all(
        ids.map(async (id) => [id, await installed(id, AUDIO_COMPONENTS.whisperServer.file)] as const),
      );
      return new Map(found.filter(([, path]) => path !== ''));
    },
  };
}

/** The kinds that run whisper straight away need whisper-cli (and language id its tiny model): name what is missing. */
function missingComponent(deps: AudioJobDeps) {
  return (kind: string) => {
    // The indexing kinds check for themselves (a silent file needs no whisper); these run whisper at once.
    if (kind !== 'audio.detectLanguage' && kind !== 'audio.transcribeWhisper') return undefined;
    if (!deps.whisper.binary) return modelMissing(AUDIO_COMPONENTS.whisperCli.id);
    if (kind === 'audio.detectLanguage' && !deps.whisper.tiny) return modelMissing(AUDIO_COMPONENTS.tiny.id);
    return undefined;
  };
}

function modelMissing(component: string) {
  return ModelMissing({ component });
}
