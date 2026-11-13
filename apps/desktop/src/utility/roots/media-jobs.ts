// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Media jobs for the jobs process. FFmpeg comes from the app's sidecars.
 * The derived-file cache uses the Settings cap (read at start and before each
 * run), keeps it (cache-cap.ts: after a put over it, and at start), asks the
 * library before each file goes, and reports evictions on this process's bus.
 */
import { join } from 'node:path';
import { MEDIA_CACHE_CAP_SETTING, type EventBus, type SettingsStore } from '@taalcut/core';
import {
  createBinaryResolver,
  createDerivedCache,
  createMediaJobs,
  createMediaService,
  decodeProfileFor,
  engineHardwareBackends,
  ffmpegBuildTarget,
  type DecodeProfileSource,
  type HardwareSessionGate,
  type NamedVideoBackends,
  type SpeechPcmPort,
} from '@taalcut/media';
import { FORCE_CPU_ENV, hardwareVideoEngine } from '@taalcut/models';
import { mediaCacheRoot } from '../../shared/media-cache';
import { createCacheCap, type CacheCap, type CacheCapPorts } from './cache-cap';
import type { UtilityConfig } from '../../shared/rpc-ipc';
import type { ProbedHardware } from '../../shared/tokens';

/**
 * FFmpeg from the app's resources when packaged (the platform's build folder: `bin` on a Mac, `ffmpeg` with its
 * `bin/` and `lib/` on Linux; LGPL only, checked against the build pinned in @taalcut/media, and no environment:
 * TAALCUT_FFMPEG_DIR must not beat the signed sidecar). A checkout has no sidecars (Resources is Electron's own),
 * and a sidecar directory, even a missing one, would win over the development build: so there it's
 * TAALCUT_FFMPEG_DIR, else the platform's folder under tools/ffmpeg/dist, which media finds from its own location
 * (out/utility/*.mjs is as deep in the repo as its source file).
 */
export function mediaBinaries(config: UtilityConfig) {
  const folder = ffmpegBuildTarget()?.resourcesFolder ?? 'bin';
  return createBinaryResolver(
    config.packaged
      ? { sidecarDir: join(config.resourcesPath, folder), requireLgpl: true, env: {} }
      : { development: true },
  );
}

export interface MediaJobWiring {
  /** The service behind the jobs, shared with vision's kinds. */
  readonly service: ReturnType<typeof createMediaService>;
  readonly jobs: ReturnType<typeof createMediaJobs>;
  /** The same cache the service writes. Look jobs put grade cubes here. */
  readonly cache: ReturnType<typeof createDerivedCache>;
  /** The process's bus, and what keeping the cap needs from the rest of the process (without it: no runs). */
  attach(events: EventBus, cap?: CacheCapPorts): void;
  readCap(settings: SettingsStore): Promise<void>;
  /** At start, after readCap: a cache already over its cap is kept to it. */
  checkCap(): void;
  /** No more runs (quit). */
  stopCap(): void;
}

/**
 * The decoder the thumbnail and filmstrip use where a plan names no hardware decoder (IX2-T4: NVDEC on an
 * NVIDIA Windows machine, D3D11VA on other GPUs), from the same probe and engine as the session cap. A Mac's
 * plans name VideoToolbox themselves. A failed probe leaves the plan's own route.
 */
export function hardwareDecodeProfile(hardware: () => Promise<ProbedHardware>): DecodeProfileSource {
  return () =>
    hardware().then(
      (probed) => decodeProfileFor(hardwareVideoEngine(probed.info)),
      () => undefined,
    );
}

/**
 * The hardware video rows the probe names for this machine (an NVIDIA card CUDA can open: `cuda`; none with
 * `CUDA_VISIBLE_DEVICES=-1`), which media narrows its platform's rows to before their device trials. With
 * `TAALCUT_FORCE_CPU=1` hardware video is off on purpose, so every CPU choice records `disabled`. A failed probe
 * names nothing: media then proves the platform's default rows by trial alone.
 */
export function hardwareVideoBackends(hardware: () => Promise<ProbedHardware>): NamedVideoBackends {
  return () =>
    hardware().then(
      (probed) =>
        probed.info.forcedCpu
          ? { backends: [], disabled: `hardware video turned off (${FORCE_CPU_ENV}=1)` }
          : { backends: engineHardwareBackends(hardwareVideoEngine(probed.info)) },
      () => undefined,
    );
}

/**
 * `speechPcm`: audio's asset audio store, so waveforms read the audio pass's PCM instead of decoding again.
 * `hardware`: the probe, for the thumbnail's and filmstrip's decode profile and the machine's video rows.
 */
export function wireMediaJobs(
  config: UtilityConfig,
  hardwareSessions?: HardwareSessionGate,
  speechPcm?: SpeechPcmPort,
  hardware?: () => Promise<ProbedHardware>,
): MediaJobWiring {
  let capBytes = MEDIA_CACHE_CAP_SETTING.defaultValue;
  let events: EventBus | undefined;
  let ports: CacheCapPorts | undefined;
  let keeper: CacheCap | undefined;
  const cache = createDerivedCache({
    root: mediaCacheRoot(config.userData),
    get capBytes() {
      return capBytes;
    },
    get release() {
      return ports?.release;
    },
    onEvicted: (payload) => events?.emit('media.derivedEvicted', payload),
    onOverCap: () => keeper?.overCap(),
  });

  const service = createMediaService({
    resolver: mediaBinaries(config),
    cache,
    ...(hardwareSessions ? { hardwareSessions } : {}),
    ...(speechPcm ? { speechPcm } : {}),
    ...(hardware
      ? { decodeProfile: hardwareDecodeProfile(hardware), videoBackends: hardwareVideoBackends(hardware) }
      : {}),
  });
  return {
    service,
    cache,
    jobs: createMediaJobs(service),
    attach(bus, cap) {
      events = bus;
      ports = cap;
      keeper?.stop();
      keeper = cap
        ? createCacheCap({
            cache,
            events: bus,
            ports: cap,
            capBytes: () => capBytes,
            setCap: (bytes) => {
              capBytes = bytes;
            },
            log: (message) => console.warn(`[media] ${message}`),
          })
        : undefined;
    },
    async readCap(settings) {
      const stored = await settings.get(MEDIA_CACHE_CAP_SETTING);
      if (stored.ok) capBytes = stored.value;
    },
    checkCap: () => keeper?.checkAtStart(),
    stopCap: () => keeper?.stop(),
  };
}
