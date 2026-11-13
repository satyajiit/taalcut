// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The make flow's tool and skill modules as the desktop's agent process
 * composes them (apps/desktop agent-make-tools.ts and agent-flows.ts), in the
 * same order, so a session recorded here replays there: templates and the
 * sandbox, render, AGT2's `video` module (video.done, video.compare) and captions (with audio's captions.translate),
 * one `timeline` module with the timeline package's tools and render's
 * captureFrame, then audio's speech cleanup (agent-audio.ts) and, because the
 * library keeps generated files, audio's voice, music and sound modules
 * (compose-phase3.ts); skills for every flow and the Voice director. The demo
 * never runs them (no jobs process, no render process, an empty shot catalogue,
 * no translator): only what the model is offered has to match.
 *
 * LRN1-TPL: `templates.search` and `timeline.fitTemplates` as agent-template-index.ts serves them before the jobs
 * process answers with an embedding space: search by words alone, and a fitter whose template vectors are
 * EmbedderUnavailable. Tool search ranks over the whole catalogue, so both are offered here as there.
 */
import { join } from 'node:path';
import {
  cleanupTools,
  createCaptionTranslator,
  createRecommendDspChainTool,
  createSnapToGrooveTool,
  translateToolModule,
} from '@taalcut/audio';
import {
  createEventBus,
  defineToolModule,
  err,
  newId,
  NotImplementedError,
  ok,
  systemClock,
  type JobRunner,
  type RenderWorker,
  type SettingsStore,
  type SkillModule,
  type TextTranslator,
  type ToolModule,
} from '@taalcut/core';
import { agentSkillModule } from '@taalcut/agent';
import {
  type createLibraryPorts,
  createRenderStore,
  createStyleProfileStore,
  createShotProfileSource,
  createTemplateSearch,
  shotDescriptions,
  createTemplateStore,
  type LibraryDatabase,
  type LibraryTimelineStore,
} from '@taalcut/library';
import {
  captionToolModule,
  compositionToolModule,
  createRenderSkillModule,
  createVideoDoneLedger,
  eyesToolModules,
  makerDone,
  renderToolModule,
  videoToolModule,
  withVideoEyes,
  timelineAccessOverStore,
  timelineToolModule as renderTimelineToolModule,
  type VideoDoneDeps,
} from '@taalcut/render';
import {
  createBreakdownJobLog,
  createStyleProfiles,
  createTemplateService,
  createTemplateSkills,
  templatesToolModule,
} from '@taalcut/templates';
import {
  audioEditToolModule,
  createCastingEngine,
  createMemoryShotCatalog,
  createTemplateFitter,
  createTimelineService,
  storeTemplateReader,
  timelineSkillModule,
  timelineToolModule,
} from '@taalcut/timeline';
import { createExperimentSandbox, sandboxToolModule } from '@taalcut/tools';
import { EmbedderUnavailable } from '@taalcut/vision';
import { listenAudioTools } from './compose-listen';
import { demoSink, generationModules, voiceSkills } from './compose-phase3';

/** No render process here: the demo never exports or captures a frame. */
const noRenderWorker: RenderWorker = {
  export: async () => err(NotImplementedError({ feature: 'render.export' })),
  captureFrame: async () => err(NotImplementedError({ feature: 'timeline.captureFrame' })),
};

/** The desktop's agent chain in the recorded sessions is a cloud model, so the tool registers as the cloud one. */
const noTranslator: TextTranslator = {
  placement: () => 'cloud',
  translate: async () => err(NotImplementedError({ feature: 'captions.translate' })),
};

export interface MakeFlowDeps {
  readonly db: LibraryDatabase;
  readonly commands: ReturnType<typeof createLibraryPorts>['commands'];
  readonly settings: SettingsStore;
  readonly acknowledgements: Parameters<typeof templatesToolModule>[0]['acknowledgements'];
  readonly timelines: LibraryTimelineStore;
  readonly jobs: JobRunner;
  /** Taalcut's own data folder (template assets, scratch). */
  readonly appData: string;
}

export function makeFlowModules(deps: MakeFlowDeps): {
  modules: ToolModule[];
  /** The skills over the whole registry's tools (the Maker lists the registered ones, as agent-timeline.ts does). */
  skills: (registered: (tool: string) => boolean) => SkillModule[];
  /** AGT2: render's eyes; their library tools join the library module (compose.ts), as in agent-loop.ts. */
  eyes: ReturnType<typeof eyesToolModules>;
} {
  const clock = systemClock;
  const store = createTemplateStore(deps.db, {
    assetsDir: join(deps.appData, 'templates', 'assets'),
    commands: deps.commands,
  });
  const templateService = createTemplateService({ store, clock });
  const sandbox = createExperimentSandbox({ root: join(deps.appData, 'scratch'), jobs: deps.jobs, clock });
  const templates = storeTemplateReader(store);
  const engine = createCastingEngine({
    catalog: createMemoryShotCatalog([]),
    embedder: {
      space: { model: 'none', revision: 'none', dimensions: 1, indexName: 'none' },
      embedTexts: async () => err(NotImplementedError({ feature: 'embeddings' })),
    },
  });
  // As the desktop's TemplateFitterToken before a space opens: no shot vectors, no template vectors.
  const fit = createTemplateFitter({
    profiles: createShotProfileSource({ db: deps.db }),
    templates: store,
    vectors: async () =>
      err(EmbedderUnavailable(undefined, { detail: 'the demo serves no embedding space' })),
  });
  const timelineService = createTimelineService({
    store: deps.timelines,
    events: createEventBus({ clock }),
    engine,
    templates,
    fit,
  });
  const renderTimelines = renderTimelineToolModule({ worker: noRenderWorker });
  const renders = createRenderStore(deps.db);
  const breakdownJobs = createBreakdownJobLog();
  // As the desktop's: timeline.cast's rerank list reads the library's shot descriptions (FIX-LIBRARIAN).
  const ownTimeline = timelineToolModule({
    engine,
    service: timelineService,
    templates,
    clock,
    fit,
    shotDescriptions: async (ids) => ok(shotDescriptions(deps.db, ids)),
  });
  // AGT2: render's eyes as the desktop composes them (agent-eyes.ts). The demo cuts no frames: no FFmpeg for them,
  // no kept reel, no draft; only what the model is offered has to match.
  const eyes = eyesToolModules({
    timelines: timelineAccessOverStore(deps.timelines, { versions: deps.timelines.versions }),
    templates,
    renders,
    reel: async () => null,
    media: async () => null,
    scratch: join(deps.appData, 'scratch', 'eyes'),
    assets: { original: async () => ok(null) },
    subjects: {
      over: async () => ok(undefined),
      ensure: async () => err(NotImplementedError({ feature: 'library.subjects' })),
    },
  });
  // AGT2: video.done and the Maker's done-gate share one ledger of passing reasons (match-ports.ts).
  const videoDone: VideoDoneDeps = {
    store: renders,
    timelines: timelineAccessOverStore(deps.timelines, { versions: deps.timelines.versions }),
    ledger: createVideoDoneLedger(),
  };
  const modules: ToolModule[] = [
    templatesToolModule({
      sandbox,
      store,
      service: templateService,
      jobs: deps.jobs,
      acknowledgements: deps.acknowledgements,
      clock,
      ids: {
        template: () => newId<'Template'>(),
        slot: () => newId<'TemplateSlot'>(),
        overlay: () => newId<'TextOverlay'>(),
        experiment: () => newId<'Experiment'>(),
      },
      breakdownJobs,
      // LRN1-STY: the style tools (agent-style-profiles.ts); the demo has no template index and no summary model.
      styleProfiles: createStyleProfiles({
        store: createStyleProfileStore(deps.db, { commands: deps.commands }),
        templates: store,
        index: async () => undefined,
        clock,
      }),
      search: createTemplateSearch({ db: deps.db, vectors: null, embedder: null }),
    }),
    sandboxToolModule({
      sandbox,
      resolveInput: async () => err(NotImplementedError({ feature: 'sandbox.inputs' })),
    }),
    renderToolModule({
      store: renders,
      timelines: timelineAccessOverStore(deps.timelines, { versions: deps.timelines.versions }),
      settings: deps.settings,
      jobs: deps.jobs,
    }),
    // AGT2: the `video` module, video.done then video.compare, as the desktop offers it after render's
    // (match-ports.ts, agent-make-tools.ts).
    withVideoEyes(videoToolModule(videoDone), eyes),
    captionToolModule(),
    // P3-V13: the desktop's agent offers the graphics module after captions (render-phase3-agent.ts).
    compositionToolModule({
      timelines: timelineAccessOverStore(deps.timelines, { versions: deps.timelines.versions }),
    }),
    defineToolModule({ id: ownTimeline.id, tools: [...ownTimeline.tools, ...renderTimelines.tools] }),
  ];
  const offered = withAudioTools(modules, deps);
  // AGT2: the Maker, over the whole registry's tools, as the desktop's agent process composes it (agent-timeline.ts).
  const skills = (registered: (tool: string) => boolean): SkillModule[] => [
    agentSkillModule(),
    createTemplateSkills({ service: templateService, sandbox, breakdownJobs }),
    timelineSkillModule({
      service: timelineService,
      templates,
      editorFamilies: ['music', 'sfx', 'voice'],
      maker: { registered, done: makerDone(videoDone) },
    }),
    // HFW1-DSN: the Designer, as the desktop offers it beside its workspace tools (agent-render.ts).
    createRenderSkillModule({
      store: renders,
      designer: { timelines: timelineAccessOverStore(deps.timelines, { versions: deps.timelines.versions }) },
    }),
    ...voiceSkills(deps.timelines),
  ];
  return { modules: offered, skills, eyes };
}

/** Audio's tools as the desktop adds them (agent-audio.ts): captions.translate joins `captions`, then cleanup, voice, music, sfx. */
function withAudioTools(modules: readonly ToolModule[], deps: MakeFlowDeps): ToolModule[] {
  const translate = translateToolModule({
    captions: createCaptionTranslator({ translator: noTranslator }),
    translator: noTranslator,
    timelines: deps.timelines,
    estimate: () => ({ usd: 0 }),
  });
  const joined = modules.map((m) =>
    m.id === translate.id ? defineToolModule({ id: m.id, tools: [...m.tools, ...translate.tools] }) : m,
  );
  return [
    ...joined,
    defineToolModule({
      id: 'audio',
      tools: [
        ...cleanupTools({ jobs: deps.jobs, timelines: deps.timelines }),
        ...audioEditToolModule({ timelines: deps.timelines }).tools,
        createRecommendDspChainTool(),
        createSnapToGrooveTool(),
        // EAR1: the listening tools after audio's own (compose-listen.ts).
        ...listenAudioTools({ jobs: deps.jobs, appData: deps.appData }),
      ],
    }),
    ...generationModules({ timelines: deps.timelines, sink: demoSink(deps.db, deps.appData) }),
  ];
}
