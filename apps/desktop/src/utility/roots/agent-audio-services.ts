// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Audio's generation services in the agent process (packages/audio SPEC P3.3–P3.6): the voiceover service, the
 * music generator and the sound-effect service, over the providers (agent-audio-providers.ts), the library's
 * generated-file sink, FFmpeg from the app's sidecars, the Signalsmith stretcher, beat tracking as a job in the jobs
 * process, media's derived-file cache and the `sfx-pack` and `sfx-bank` components. Built on first use (FFmpeg is
 * resolved then), and only where the library can keep generated files.
 */
import {
  ClockToken,
  err,
  EventBusToken,
  GeneratedAssetSinkToken,
  JobRunnerToken,
  MusicProviderToken,
  ok,
  SfxProviderToken,
  VoiceProviderToken,
  type AsyncResult,
  type ComputeFallbackEvent,
  type Container,
} from '@taalcut/core';
import {
  audioTrackBeatsJob,
  createLoudnessMeter,
  createMusicGenerator,
  createSfxService,
  createTimeStretcher,
  createVoiceoverService,
  gridFromBeatMap,
  loadMusicPack,
  loadSfxPack,
  MusicLibraryEmpty,
  SfxPackMissing,
  type MusicBeatTracker,
  type MusicPackSource,
  type SfxPackSource,
  type VoiceoverService,
} from '@taalcut/audio';
import type { DerivedCache, MediaContext } from '@taalcut/media';
import type { UtilityConfig } from '../../shared/rpc-ipc';
import { cacheFiles, installedComponentFile } from './audio-library';
import { mediaBinaries } from './media-jobs';

export const SFX_PACK_COMPONENT = 'sfx-pack';
/** EAR1-D2: earshot's SFX bank, rendered into takes (tools/audio-packs/sfx-bank). */
export const SFX_BANK_COMPONENT = 'sfx-bank';
export const MUSIC_PACK_COMPONENT = 'music-pack';

export interface AudioAgentServices {
  readonly voiceover: VoiceoverService;
  readonly music: ReturnType<typeof createMusicGenerator>;
  readonly sfx: ReturnType<typeof createSfxService>;
}

/** Every service needs these; without the sink nothing generated could be kept. */
export function canGenerate(container: Container): boolean {
  return (
    container.has(GeneratedAssetSinkToken) &&
    container.has(VoiceProviderToken) &&
    container.has(MusicProviderToken) &&
    container.has(SfxProviderToken)
  );
}

/** Beats of a generated track: Phase 2's tracker as the `audio.trackBeats` job in the jobs process. */
function jobTracker(container: Container): MusicBeatTracker {
  return {
    async track(path, signal) {
      const tracked = await container
        .resolve(JobRunnerToken)
        .run(audioTrackBeatsJob, { path }, signal ? { signal } : {});
      return tracked.ok ? ok(gridFromBeatMap(tracked.value.beatMap)) : tracked;
    },
  };
}

/** The installed `sfx-pack` component's catalogue, read on each use (a pack installed later is found). */
function componentPack(config: UtilityConfig): SfxPackSource {
  return {
    async load() {
      const dir = installedComponentFile(config.userData, SFX_PACK_COMPONENT);
      if (!dir)
        return err(SfxPackMissing(undefined, { detail: `component ${SFX_PACK_COMPONENT} is not installed` }));
      return loadSfxPack(dir);
    },
  };
}

/** The installed `music-pack` component's catalogue; until the PO's tracks ship it is missing or empty. */
export function componentMusicPack(config: UtilityConfig): MusicPackSource {
  return {
    async load() {
      const dir = installedComponentFile(config.userData, MUSIC_PACK_COMPONENT);
      if (!dir)
        return err(
          MusicLibraryEmpty(undefined, { detail: `component ${MUSIC_PACK_COMPONENT} is not installed` }),
        );
      return loadMusicPack(dir);
    },
  };
}

/** The services, built once on first use; a failure (no FFmpeg) is answered and tried again next time. */
export function audioAgentServices(
  container: Container,
  config: UtilityConfig,
  derived: () => DerivedCache,
): () => AsyncResult<AudioAgentServices> {
  let built: AudioAgentServices | undefined;
  const onComputeFallback = (event: ComputeFallbackEvent) =>
    container.resolve(EventBusToken).emit('compute.fallback', event);

  return async () => {
    if (built) return ok(built);
    const binaries = await mediaBinaries(config).resolve();
    if (!binaries.ok) return binaries;
    const media: MediaContext = { binaries: binaries.value, onComputeFallback };
    const stretcher = await createTimeStretcher({ media, onComputeFallback });
    if (!stretcher.ok) return stretcher;
    const sink = container.resolve(GeneratedAssetSinkToken);
    const clock = container.resolve(ClockToken);
    built = {
      voiceover: createVoiceoverService({
        provider: container.resolve(VoiceProviderToken),
        sink,
        stretcher: stretcher.value,
        media,
        clock,
      }),
      music: createMusicGenerator({
        provider: container.resolve(MusicProviderToken),
        sink,
        clock,
        media,
        stretcher: stretcher.value,
        tracker: jobTracker(container),
        derived: cacheFiles(derived),
      }),
      sfx: createSfxService({
        pack: componentPack(config),
        bankDir: () => installedComponentFile(config.userData, SFX_BANK_COMPONENT),
        stretcher: stretcher.value,
        sink,
        provider: container.resolve(SfxProviderToken),
        media,
        meter: createLoudnessMeter({ media, onComputeFallback }),
        clock,
      }),
    };
    return ok(built);
  };
}
