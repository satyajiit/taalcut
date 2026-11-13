// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The gate demo composed from the real packages: the template the desktop
 * composition root copies. Library storage on one SQLite file through
 * createLibraryPorts (command audit log with its unit of work, the agent's
 * run log, the cloud-call log, settings, conversations), media through a job
 * runner, vision with a cloud model (so uploads need consent), then the make
 * flow's tools and skills as the agent process offers them (compose-make.ts:
 * templates, sandbox, render, captions, timeline; every flow's skills), the
 * agent and the chat service, which names each chat after its first
 * exchange; traces go to the library's trace store. The two model clients
 * are given: scripted ones, or the recorded session's real clients. Either
 * way they log their calls to the library's cloud-call log.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createCommandBus,
  createEventBus,
  defineToolModule,
  ok,
  systemClock,
  unwrap,
  type CloudCallSink,
  type ToolModule,
} from '@taalcut/core';
import {
  createAgent,
  createChatService,
  createCommandDispatcher,
  createConversationTitler,
  createMemoryTraceExporter,
  createSettingsConsentStore,
  createSkillRegistry,
  fromCoreEventLog,
  parseSoul,
  soulToolModule,
} from '@taalcut/agent';
import {
  createLibraryPorts,
  createLibrarySearch,
  createRepositories,
  createSourceCommands,
  createTimelineStore,
  createWorkspaceStore,
  libraryToolModule,
  openDatabase,
  readImportStatus,
} from '@taalcut/library';
import {
  createDirectJobRunner,
  createMediaJobs,
  createMediaService,
  mediaToolModule,
  type BinaryResolver,
} from '@taalcut/media';
import { createModelRuntime, type ModelClient, type ModelSelector } from '@taalcut/models';
import { createPrepareNarration } from '@taalcut/timeline';
import { withLibraryEyes } from '@taalcut/render';
import { createMemoryArtifactStore, createToolRegistry, editorHistoryTools } from '@taalcut/tools';
import { demoEditorCatalogue } from './compose-editor';
import { visionToolModule } from '@taalcut/vision';
import { CLOUD_VISION, GATE_AGENT } from '../src/index';
import { demoShortsModule } from './compose-shorts';
import { demoProductModule } from './compose-products';
import { makeFlowModules } from './compose-make';
import { demoSink, demoStyles, launchModules, pluginModules } from './compose-phase3';

export interface GateDemoOptions {
  /** The library database file. */
  readonly databasePath: string;
  readonly resolver: BinaryResolver;
  readonly home: string;
  /** Taalcut's own data folder: never a source. */
  readonly appData: string;
  /** Builds the model clients with the library's cloud-call log, so every call gets its row. */
  readonly models: (callLog: CloudCallSink) => {
    readonly agent: ModelClient;
    readonly vision: ModelClient;
  };
}

export function composeGateDemo(options: GateDemoOptions) {
  const db = unwrap(openDatabase({ path: options.databasePath }));
  const ports = createLibraryPorts(db);
  const repos = createRepositories(db);

  // Commands: the audit log commits each command's staged writes with its row.
  const bus = createCommandBus({ store: ports.auditLog, clock: systemClock });
  const sources = createSourceCommands({
    sources: repos.sources,
    folders: { protectedRoots: [options.appData], home: options.home },
    commands: ports.commands,
  });
  bus.register(sources.addSource, sources.removeSource);

  const models = options.models(ports.cloudCalls);
  const cloudSelector: ModelSelector = { resolve: (module) => ok({ module, choices: [CLOUD_VISION] }) };
  const media = createMediaService({ resolver: options.resolver });
  // The desktop root passes the jobs process's runner; the demo runs the same handlers in process.
  const jobs = createDirectJobRunner(createMediaJobs(media));
  const timelines = createTimelineStore(db, { commands: ports.commands });
  const recorder = createPrepareNarration({ timelines, events: createEventBus({ clock: systemClock }) });
  bus.register(recorder.command);
  const make = makeFlowModules({
    db,
    commands: ports.commands,
    settings: ports.settings,
    acknowledgements: ports.acknowledgements,
    timelines,
    jobs,
    appData: options.appData,
  });
  const soul = parseSoul(readFileSync(join(import.meta.dirname, '..', '..', '..', 'SOUL.md'), 'utf8'));
  // The agent process's modules in its order (apps/desktop agent-loop.ts); src/catalogue.ts checks both against
  // the catalogue the sessions were recorded with.
  const toolModules: ToolModule[] = [
    // AGT2: with render's eyes' library.frameAt and library.subjects, as agent-loop.ts folds them in.
    withLibraryEyes(
      libraryToolModule({
        db,
        // Keyword search only: the demo has no embedding model.
        search: createLibrarySearch({ db, vectors: null, embedder: null }),
        importStatus: async (sourceId) => ok(readImportStatus(db, sourceId ? { sourceId } : {})),
        home: options.home,
      }),
      make.eyes,
    ),
    mediaToolModule({ jobs }),
    visionToolModule(
      { jobs, models: models.vision, selector: cloudSelector, runtime: createModelRuntime() },
      // vision.matchLook, as the desktop offers it over the library's Style store (agent-loop.ts).
      { matchLook: { styles: demoStyles(db, options.appData), jobs } },
    ),
    // The agent process's make-flow modules (apps/desktop agent-make-tools.ts), offered as there.
    ...make.modules.map((module) =>
      module.id === 'timeline'
        ? defineToolModule({ id: module.id, tools: [...module.tools, ...recorder.tools.tools] })
        : module,
    ),
    // Then its Phase 3 modules (apps/desktop agent-launch.ts): tool search ranks over the whole catalogue,
    // so the demo offers the same tools or a recorded route drifts: soul, images, hub, memory (compose-phase3.ts).
    editorHistoryTools(bus),
    demoEditorCatalogue(() => registry),
    ...(soul.stops ? [soulToolModule({ stops: soul.stops })] : []),
    ...launchModules({
      timelines,
      sink: demoSink(db, options.appData),
      selector: cloudSelector,
      db,
      log: fromCoreEventLog(ports.eventLog),
      // HFW1-DSN: the project's HyperFrames workspace (apps/desktop workspace-store.ts), in the demo's own data folder.
      workspaces: createWorkspaceStore(db, { dataRoot: options.appData, commands: ports.commands }),
      appData: options.appData,
    }),
    demoProductModule(db),
    demoShortsModule(),
    // Then `plugins`, as the desktop offers it once main is connected (agent-plugins.ts).
    ...pluginModules(),
  ];
  const registry = unwrap(createToolRegistry(toolModules));
  const agentWindow = createModelRuntime({ builtinProviders: [GATE_AGENT.provider] }).findModel(
    GATE_AGENT.provider,
    GATE_AGENT.model,
    'chat',
  )?.contextWindow;

  const traces = createMemoryTraceExporter();
  const agent = createAgent({
    models: models.agent,
    tools: registry,
    log: fromCoreEventLog(ports.eventLog),
    soul,
    commands: createCommandDispatcher(bus),
    artifacts: createMemoryArtifactStore(),
    consents: createSettingsConsentStore(ports.settings),
    cloudProviders: (module) => (module === 'vision' ? [CLOUD_VISION.provider] : []),
    traceExporter: traces,
    traces: ports.traces,
    settings: { autonomy: 'before-render', budget: { maxUsd: 1, maxTokens: 500_000 } },
    // Every flow's skills, as the desktop composes them (agent-flows.ts).
    // AGT2: the Maker lists every tool registered in the whole registry, as the desktop's agent-timeline.ts checks it.
    skills: unwrap(
      createSkillRegistry(
        make.skills((tool) => registry.describe(tool) !== undefined),
        registry,
      ),
    ),
    // AGT2: the agent model's window, as the desktop reads it (model-windows.ts): a step's tool offer is sized by it.
    contextWindow: () => agentWindow,
  });
  // The chat is named after its first exchange by the agent's client (asked as the router: no router model here).
  const chat = createChatService({
    agent,
    conversations: ports.conversations,
    titles: createConversationTitler(models.agent),
  });

  return {
    agent,
    chat,
    bus,
    toolModules,
    ports,
    repos,
    traces,
    consents: createSettingsConsentStore(ports.settings),
    close: () => {
      chat.close();
      db.close();
    },
  };
}
