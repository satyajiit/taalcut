// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The Phase 3 tool and skill modules the desktop's agent process offers because the library keeps generated files,
 * Styles and the hub's stores (apps/desktop library-phase3.ts): vision.matchLook (agent-loop.ts), audio's voice,
 * music and sound modules after `audio` (agent-audio.ts) with the Voice director (agent-audio-skills.ts), then
 * `images`, `hub` and `memory` after soul (agent-launch.ts), then `plugins` (agent-plugins.ts). Tool search ranks
 * over the whole catalogue, so the demo offers the same tools or a recorded route drifts (src/catalogue.ts checks
 * both sides). The demo never runs them: the services behind them answer core.not_implemented, and only the
 * library's real generated-asset sink is wired, as on the desktop.
 */
import { join } from 'node:path';
import {
  createMusicLibrary,
  createSynthesizeSfxTool,
  createVoiceSkillModule,
  musicGenerationToolModule,
  musicLibraryTools,
  sfxToolModule,
  voiceToolModule,
  type GenerationPrices,
} from '@taalcut/audio';
import {
  defineToolModule,
  err,
  newId,
  NotImplementedError,
  type GeneratedAssetSink,
  type HubService,
  type PluginAgentService,
  type SkillModule,
  type TimelineStore,
  type ToolModule,
  type WorkspaceStore,
} from '@taalcut/core';
import { memoryRunFacts, memoryToolModule, type EventLogStore } from '@taalcut/agent';
import {
  commentToolModule,
  createCommentStore,
  createGeneratedAssetSink,
  createMemoryRanker,
  createMemoryStore,
  createStyleStore,
  memoryScopeName,
  type LibraryDatabase,
  type LibraryTimelineStore,
} from '@taalcut/library';
import { ELEVENLABS_MODELS, elevenLabsPrice, imageToolModule, type ModelSelector } from '@taalcut/models';
import { timelineAccessOverStore, workspaceToolModule } from '@taalcut/render';
import { hubToolModule } from '@taalcut/templates';
import { pluginsToolModule, SandboxUnavailable, workspaceShellTools } from '@taalcut/tools';
import { listenSfxTools } from './compose-listen';

const notServed = (feature: string) => async () => err(NotImplementedError({ feature }));

const usdPer = (model: string) => elevenLabsPrice(model)?.usdPerUnit ?? 0;

/** The desktop's list prices (agent-audio-prices.ts): models' ElevenLabs table. */
export const demoGenerationPrices: GenerationPrices = {
  voicePerCharacter: (quality) =>
    usdPer(quality === 'final' ? ELEVENLABS_MODELS.final : ELEVENLABS_MODELS.draft),
  musicPerSecond: () => usdPer(ELEVENLABS_MODELS.music),
  sfxPerSecond: () => usdPer(ELEVENLABS_MODELS.soundEffect),
};

/** The library's sink over the demo's database, its originals root inside the demo's own data folder. */
export function demoSink(db: LibraryDatabase, appData: string): GeneratedAssetSink {
  return createGeneratedAssetSink(db, { originalsRoot: join(appData, 'Originals') });
}

/** The library's Style store, for vision.matchLook (logos inside the demo's own data folder). */
export function demoStyles(db: LibraryDatabase, appData: string) {
  return createStyleStore(db, { assetsDir: join(appData, 'styles', 'assets') });
}

/** voice, music and sfx, in the desktop's order (agent-audio.ts `audioToolModules`). */
export function generationModules(deps: {
  readonly timelines: TimelineStore;
  readonly sink: GeneratedAssetSink;
}): ToolModule[] {
  const { timelines } = deps;
  const prices = demoGenerationPrices;
  return [
    voiceToolModule({
      voiceover: {
        generate: notServed('voice.generate'),
        editLine: notServed('voice.editLine'),
        place: notServed('voice.place'),
        finalize: notServed('voice.finalize'),
      },
      provider: { voices: notServed('voice.voices') },
      timelines,
      prices,
    }),
    musicGenerationToolModule(
      { generator: { generate: notServed('music.generate') }, timelines, prices },
      musicLibraryTools({
        library: createMusicLibrary({ pack: { load: notServed('music.pack') }, sink: deps.sink }),
        readTimeline: notServed('music.readTimeline'),
      }),
    ),
    defineToolModule({
      id: 'sfx',
      tools: [
        ...sfxToolModule({
          service: { addHits: notServed('sfx.addHits'), generateHit: notServed('sfx.generateHit') },
          timelines,
          prices,
        }).tools,
        createSynthesizeSfxTool(),
        // EAR1-B2: sfx.searchSounds after it (compose-listen.ts).
        ...listenSfxTools(),
      ],
    }),
  ];
}

/** The Voice director, beside every flow's skills (agent-audio-skills.ts). */
export function voiceSkills(timelines: TimelineStore): SkillModule[] {
  return [createVoiceSkillModule({ timelines, prices: demoGenerationPrices })];
}

const noHub: Pick<HubService, 'browse' | 'get'> = {
  browse: notServed('hub.browse'),
  get: notServed('hub.get'),
};

/**
 * `images`, `hub`, `memory` (LRN1-MEM: memory.remember, memory.recall over the library's memory store, with no
 * embedding space, as before the jobs process serves one), `comments` (EDT1-CMT: comments.list, comments.reply
 * over the library's comment store) then `workspace` (HFW1-DSN: the Designer's tools over the library's workspace
 * store, with no render process to draw stills; AGT2 sbx: the workspace shell's tools after them, with no jobs
 * process to run a command in), after soul (agent-launch.ts `launchToolModules`).
 */
export function launchModules(deps: {
  readonly timelines: LibraryTimelineStore;
  readonly workspaces: WorkspaceStore;
  /** The demo's own data folder: the shell's folders would be under it. */
  readonly appData: string;
  readonly sink: GeneratedAssetSink;
  readonly selector: ModelSelector;
  readonly db: LibraryDatabase;
  readonly log: Pick<EventLogStore, 'read'>;
}): ToolModule[] {
  const memory = createMemoryStore(deps.db);
  return [
    imageToolModule({ providers: [], selector: deps.selector, sink: deps.sink, timelines: deps.timelines }),
    hubToolModule({
      service: noHub,
      ids: { template: () => newId<'Template'>() },
      openShare: () => undefined,
    }),
    memoryToolModule({
      ranker: createMemoryRanker({ store: memory, space: async () => null }),
      run: memoryRunFacts(deps.log),
      scopeName: async (scope) => memoryScopeName(deps.db, scope),
    }),
    commentToolModule({ store: createCommentStore(deps.db), timelines: deps.timelines }),
    defineToolModule({
      id: 'workspace',
      tools: [
        ...workspaceToolModule({
          store: deps.workspaces,
          timelines: timelineAccessOverStore(deps.timelines, { versions: deps.timelines.versions }),
        }).tools,
        ...workspaceShellTools({
          store: deps.workspaces,
          root: join(deps.appData, 'shell'),
          runner: {
            run: async () => err(SandboxUnavailable(undefined, { detail: 'no jobs process in the demo' })),
          },
          resolveInput: async () => err(SandboxUnavailable()),
        }),
      ],
    }),
  ];
}

/** Main's plugin service, as the agent process reaches it over RPC (agent-plugins.ts); the demo never calls it. */
const noPlugins: PluginAgentService = {
  list: notServed('plugins.list'),
  describe: notServed('plugins.describe'),
  tools: notServed('plugins.tools'),
  readSkill: notServed('plugins.readSkill'),
  configure: notServed('plugins.configure'),
  setEnabled: notServed('plugins.setEnabled'),
  setAccess: notServed('plugins.setAccess'),
  disconnect: notServed('plugins.disconnect'),
  requestSetup: notServed('plugins.requestSetup'),
  testConnection: notServed('plugins.testConnection'),
  invoke: notServed('plugins.invoke'),
};

/**
 * `plugins` (UX2-GSAP), last, as the desktop's agent process offers it whenever main is connected
 * (agent-loop.ts `agentPluginTools`). LRN1-FIX: without it the demo's catalogue was seven tools short of the
 * desktop's, so tool search loaded other tools there and the desktop's gate journey stopped replaying.
 */
export function pluginModules(): ToolModule[] {
  return [pluginsToolModule(noPlugins)];
}
