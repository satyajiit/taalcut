// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Audio's Phase 3 in the agent process (packages/audio SPEC P3.8–P3.11), joined to the root with one call each:
 * `registerAudioAgent` (providers, services, core's SpeechCleanupSource for the timeline's cleanup planner),
 * `registerAudioCommands` (voice, consent, ducking and sound-effect handlers, announced after commit),
 * `withAudioTools` (the voice, music, sfx and audio tool modules after the make flow's, and `captions.translate`
 * folded into render's `captions` module, then EAR1's listening tools from agent-listen-qa.ts and
 * agent-listen-search.ts); the Voice director is agent-audio-skills.ts'. Paid generation joins where
 * the library keeps its output (GeneratedAssetSinkToken); local synthesis uses run artifacts. Consent needs its store.
 */
import {
  ClockToken,
  CommandBusToken,
  createToken,
  defineToolModule,
  EventBusToken,
  GeneratedAssetSinkToken,
  JobRunnerToken,
  MEDIA_CACHE_CAP_SETTING,
  SpeechCleanupSourceToken,
  TextTranslatorToken,
  TimelineStoreToken,
  upgradeTimeline,
  VoiceConsentStoreToken,
  VoiceProviderToken,
  createCommitAnnouncer,
  type AnyCommand,
  type AsyncResult,
  type Container,
  type ToolModule,
} from '@taalcut/core';
import {
  cleanupTools,
  createCaptionTranslator,
  createDuckingCommand,
  createSfxCommands,
  createSpeechCleanupSource,
  createMusicLibrary,
  createRecommendDspChainTool,
  createSnapToGrooveTool,
  createSynthesizeSfxTool,
  createVoiceCommands,
  musicLibraryTools,
  musicGenerationToolModule,
  sfxToolModule,
  translateToolModule,
  voiceToolModule,
} from '@taalcut/audio';
import { createDerivedCache, type DerivedCache } from '@taalcut/media';
import { audioEditToolModule } from '@taalcut/timeline';
import { mediaCacheRoot } from '../../shared/media-cache';
import type { UtilityConfig } from '../../shared/rpc-ipc';
import { LibraryDatabaseToken, UtilityConfigToken } from '../../shared/tokens';
import { consentCommands } from './agent-audio-consent';
import { generationPrices } from './agent-audio-prices';
import { registerAudioProviders } from './agent-audio-providers';
import {
  audioAgentServices,
  canGenerate,
  componentMusicPack,
  type AudioAgentServices,
} from './agent-audio-services';
import { lazyMusic, lazySfx, lazyVoiceover, translationEstimate } from './agent-audio-lazy';
import { templateHitsOf } from './agent-audio-reel';
import { listenCloudToolModules } from './agent-listen-cloud';
import { listenQaToolModules } from './agent-listen-qa';
import { listenMusicDescribe, listenSearchToolModules } from './agent-listen-search';
import { cacheJson, libraryAssetHashes } from './audio-library';

const AudioServicesToken = createToken<() => AsyncResult<AudioAgentServices>>('agent.audioServices');
/** media's derived-file cache, opened in this process on first use (speech analyses, warped music). */
const AgentDerivedCacheToken = createToken<DerivedCache>('agent.derivedCache');

export function registerAudioAgent(container: Container, config: UtilityConfig): void {
  registerAudioProviders(container);
  container.factory(AgentDerivedCacheToken, () =>
    createDerivedCache({
      root: mediaCacheRoot(config.userData),
      capBytes: MEDIA_CACHE_CAP_SETTING.defaultValue,
    }),
  );
  container.value(
    AudioServicesToken,
    audioAgentServices(container, config, () => container.resolve(AgentDerivedCacheToken)),
  );
  if (container.has(LibraryDatabaseToken) && !container.has(SpeechCleanupSourceToken))
    container.factory(SpeechCleanupSourceToken, () =>
      createSpeechCleanupSource({
        assets: libraryAssetHashes(container),
        derived: cacheJson(() => container.resolve(AgentDerivedCacheToken)),
      }),
    );
}

/** The voice, ducking, sound-effect and consent commands on this process's bus. */
export function registerAudioCommands(container: Container): void {
  if (!container.has(TimelineStoreToken)) return;
  const bus = container.resolve(CommandBusToken);
  const announcer = createCommitAnnouncer();
  const deps = {
    store: container.resolve(TimelineStoreToken),
    clock: container.resolve(ClockToken),
    announcer,
  };
  const commands: AnyCommand[] = [
    ...createVoiceCommands(deps).all,
    createDuckingCommand(deps),
    ...createSfxCommands(deps).all,
    ...consentCommands(container),
  ];
  bus.register(...commands);
  // `library.changed` for each committed timeline command (never before its writes commit).
  announcer.attach(bus, container.resolve(EventBusToken));
}

/** A module joins its namesake (render's `captions`, say) or comes after the others. */
function joined(modules: readonly ToolModule[], module: ToolModule): ToolModule[] {
  const at = modules.findIndex((m) => m.id === module.id);
  if (at < 0) return [...modules, module];
  const merged = defineToolModule({ id: module.id, tools: [...(modules[at]?.tools ?? []), ...module.tools] });
  return modules.map((m, i) => (i === at ? merged : m));
}

function audioToolModules(container: Container): ToolModule[] {
  if (!container.has(TimelineStoreToken)) return [];
  const timelines = container.resolve(TimelineStoreToken);
  const modules: ToolModule[] = [];
  if (container.has(TextTranslatorToken)) {
    const translator = container.resolve(TextTranslatorToken);
    modules.push(
      translateToolModule({
        captions: createCaptionTranslator({ translator }),
        translator,
        timelines,
        estimate: translationEstimate(container),
      }),
    );
  }
  modules.push(
    defineToolModule({
      id: 'audio',
      // EDT1-OPS: the sound's edits (the timeline package handles their commands) join audio's own tools.
      tools: [
        ...cleanupTools({ jobs: container.resolve(JobRunnerToken), timelines }),
        ...audioEditToolModule({ timelines }).tools,
        createRecommendDspChainTool(),
        createSnapToGrooveTool(),
      ],
    }),
  );
  // Local synthesis writes to the run's artifact store, so it needs neither a paid provider nor a library sink.
  const procedural = createSynthesizeSfxTool({
    onComputeFallback: (event) => container.resolve(EventBusToken).emit('compute.fallback', event),
  });
  if (!canGenerate(container)) return [...modules, defineToolModule({ id: 'sfx', tools: [procedural] })];
  const services = container.resolve(AudioServicesToken);
  return [
    ...modules,
    voiceToolModule({
      voiceover: lazyVoiceover(services),
      provider: container.resolve(VoiceProviderToken),
      timelines,
      prices: generationPrices,
      ...(container.has(VoiceConsentStoreToken)
        ? { consents: container.resolve(VoiceConsentStoreToken) }
        : {}),
    }),
    musicGenerationToolModule(
      { generator: lazyMusic(services), timelines, prices: generationPrices },
      musicLibraryTools({
        library: createMusicLibrary({
          pack: componentMusicPack(container.resolve(UtilityConfigToken)),
          sink: container.resolve(GeneratedAssetSinkToken),
        }),
        readTimeline: async (timelineId) => {
          const stored = await timelines.get(timelineId);
          return stored.ok ? upgradeTimeline(stored.value.json, stored.value.schemaVersion) : stored;
        },
        // EAR1-B3: `describe` listens through the jobs process (agent-listen-search.ts).
        ...listenMusicDescribe(container),
      }),
    ),
    defineToolModule({
      id: 'sfx',
      tools: [
        ...sfxToolModule({
          service: lazySfx(services),
          timelines,
          prices: generationPrices,
          // EAR1-G1: `fromTemplate`, the template reel's effects (agent-audio-reel.ts).
          ...templateHitsOf(container, container.resolve(UtilityConfigToken)),
        }).tools,
        procedural,
      ],
    }),
  ];
}

/** The make flow's modules with audio's: new modules after them, so recorded sessions keep their tool order. */
export function withAudioTools(container: Container, modules: readonly ToolModule[]): ToolModule[] {
  // EAR1: the listening tools join their namesakes (`audio`, `sfx`) after audio's own; lanes A and B fill the lists.
  const listen = [
    ...listenQaToolModules(container),
    ...listenSearchToolModules(container),
    // EAR1-X1: `audio.cloudCritique`, the consented upload (agent-listen-cloud.ts).
    ...listenCloudToolModules(container),
  ];
  return [...audioToolModules(container), ...listen].reduce(joined, [...modules]);
}
