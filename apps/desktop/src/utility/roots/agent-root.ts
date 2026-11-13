// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The agent process's composition root: the command bus (it owns the audit
 * log) with the settings, model and source commands; the models (agent-
 * models.ts); the agent loop and chat (agent-loop.ts); and the routers for
 * UTILITY_CONTRACTS.agent: diagnostics, events, commands, models, usage,
 * traces, chat, consents (standing upload consents: list, revoke), system
 * (Settings → About), plus main's run resumes and credential changes.
 */
import { agentImportCommands } from './agent-imports';
import {
  agentRunsContract,
  AuditLogStoreToken,
  ChatServiceToken,
  chatRouter,
  ClockToken,
  CommandBusToken,
  commandsRouter,
  connectRpc,
  consentsRouter,
  createCommandBus,
  createDirectJobRunner,
  createSettingsCommands,
  createUiCommands,
  credentialChangesContract,
  EventBusToken,
  EventLogStoreToken,
  forwardCommandEvents,
  implementContract,
  interfaceSoundsRouter,
  INSTAGRAM_PROVIDER,
  InstagramSavedStoreToken,
  InstagramSessionProviderToken,
  JobRunnerToken,
  jobRunnerOverRpc,
  LOCAL_SERVER_KINDS,
  MAIN_SERVICE_CONTRACTS,
  MODEL_COMMANDS,
  SettingsStoreToken,
  TraceStoreToken,
  tracesRouter,
  UsageLimitsToken,
  UsageStoreToken,
  usageRouter,
  UTILITY_CONTRACTS,
  unwrapRpc,
  type CloudCallSink,
  type Container,
  type JobRunner,
  type PortLike,
} from '@taalcut/core';
import { consentsService, fromCoreEventLog, restoreEditorOwnership } from '@taalcut/agent';
import {
  computeReport,
  type ModelClient,
  type ModelRuntime,
  type ModelRuntimeOptions,
} from '@taalcut/models';
import { syncLocalServers } from '../../shared/account-settings';
import { readHubInstallKey } from '../../shared/hub-install-key';
import { createRpcInstagramSessionProvider } from '../../shared/instagram-session';
import type { UtilityConfig } from '../../shared/rpc-ipc';
import {
  AgentMainServicesToken,
  CredentialProviderToken,
  HardwareProbeToken,
  LocalRuntimeToken,
  ModelProfilesToken,
  ModelRuntimeToken,
  ModelSettingsToken,
  PlanBillingToken,
  type LocalRuntimeSlot,
  type ProbedHardware,
} from '../../shared/tokens';
import type { UtilityRoot } from '../runtime';
import { registerAudioAgent, registerAudioCommands } from './agent-audio';
import { audioCredentialsChanged } from './agent-audio-providers';
import { registerExternalRuns } from './agent-external-runs';
import { HubInstallKeyToken } from './agent-templates-hub';
import { launchCommands } from './agent-launch';
import { registerUsageLimits } from './agent-limits';
import { registerRateLimitFollower, startRateLimitFollower } from './agent-limits-follower';
import { registerAgentLoop, startAgentLoop, AgentToken, ConsentStoreToken } from './agent-loop';
import { registerAgentModels, startAgentModels } from './agent-models';
import { backgroundModelsRouters } from './agent-background-models';
import { registerAgentFlows } from './agent-flows';
import { restartingJobRunner } from './agent-job-runner';
import { agentPhase2Routers } from './agent-phase2';
import { agentMcpCommands, agentMcpRouters, registerAgentMcp, startAgentMcp } from './agent-mcp';
import { agentMemoryRouter, registerAgentMemory, startAgentMemory } from './agent-memory';
import { agentCommentsRouter, registerAgentComments } from './agent-comments';
import { agentWorkspaceRouter } from './agent-workspace';
import { workspaceShellCommands } from './workspace-shell';
import { pruneWorkspacesLater, registerWorkspaceStore } from './workspace-store';
import { registerCastingPrefs, startCastingPrefs } from './agent-casting-prefs';
import { agentPhase3Routers } from './agent-phase3';
import { agentServiceCommands, registerAgentServices, startAgentServices } from './agent-services';
import { registerCaptionCommandsWhenReady, renderAgentCommands } from './agent-render';
import { registerExperimentSandbox, scratchRoot } from './agent-templates';
import { startTemplateIndex } from './agent-template-index';
import { startFillChecks } from './agent-fill-checks';
import { templateDesignerOf } from './agent-designer';
import { startTemplateDesignFor } from './agent-template-designing';
import { createTemplateDesignTracker, TemplateDesignTrackerToken } from './template-design-tracker';
import { registerStyleProfiles, startStyleProfiles } from './agent-style-profiles';
import { registerTimelineAgent, registerTimelineCommands } from './agent-timeline';
import { libraryAgentCommands, registerLibraryAgent } from './library-agent';
import { registerLibraryPhase3Agent } from './library-phase3';
import { registerLibraryProfiles } from './library-profiles';
import { commonRouters, createUtilityContainer } from './base';
import { registerAgentTelemetry } from './telemetry';
import { agentUpdateCommands } from './agent-updates';
import { modelsRouter } from './model-settings';
import { cudaRuntimeRow, gpuSetupOf } from './gpu-setup';
import { componentsRoot } from './machine-accelerators';
import { componentList, NOTHING_TO_DOWNLOAD, systemRouter } from './system-info';
import { speechRouter, spokenLanguageCommands } from './audio-languages';
import { registerCreation } from '../creation/module';
import { registerProducts } from '../products/module';

export interface AgentRootOptions {
  /** SOUL.md, the agent's operating principles (bundled into out/utility/agent.mjs). */
  readonly soul: string;
  /** The port to main's services (MAIN_SERVICE_CONTRACTS.agent). */
  readonly main?: PortLike;
  readonly pid?: number;
  /** Tests: run jobs in process instead of in the jobs process. */
  readonly jobs?: JobRunner;
  readonly hardware?: () => Promise<ProbedHardware>;
  readonly localRuntime?: (runtime: ModelRuntime) => LocalRuntimeSlot;
  /** Replaces the ModelClient (test builds only: the gate demo's recorded model session, see agent.ts). */
  readonly modelClient?: (callLog: CloudCallSink) => ModelClient;
  /** Test builds only: providers at local mock servers (see agent.ts). */
  readonly modelRuntime?: ModelRuntimeOptions;
}

function registerCommands(container: Container, config: UtilityConfig): void {
  const bus = container.resolve(CommandBusToken);
  const settings = createSettingsCommands({
    settings: container.resolve(SettingsStoreToken),
    events: container.resolve(EventBusToken),
  });
  // models.restore is the inverse undo runs, never a person's choice (models will mark it itself).
  const models = container
    .resolve(ModelSettingsToken)
    .commands.map((command) =>
      command.name === MODEL_COMMANDS.restore && !command.internal ? { ...command, internal: true } : command,
    );
  const ui = createUiCommands({ events: container.resolve(EventBusToken) });
  bus.register(
    ...settings.all,
    ...agentImportCommands(container),
    ...models,
    ...ui.all,
    ...libraryAgentCommands(container, config),
    ...agentServiceCommands(container),
    ...renderAgentCommands(container, config),
    ...agentMcpCommands(container),
    ...agentUpdateCommands(container),
    ...launchCommands(container),
    // AGT2 sbx: workspace.importMedia, media the workspace shell made into the library (workspace-shell.ts).
    ...workspaceShellCommands(container, config),
    // LIB1-LANG: the languages you speak (audio-languages.ts).
    ...spokenLanguageCommands(container),
  );
  registerTimelineCommands(container);
  registerAudioCommands(container);
  registerCaptionCommandsWhenReady(container, config);
  forwardCommandEvents(bus, container.resolve(EventBusToken));
}

/** Main asks for a crash's unfinished runs to go on (recovery.resumeRuns). */
function runsRouter(container: Container) {
  const os = implementContract(agentRunsContract);
  return os.router({
    resume: os.resume.handler(({ input }) => {
      const agent = container.resolve(AgentToken);
      for (const runId of input.runIds) {
        void agent.resume(runId).then((resumed) => {
          if (!resumed.ok) console.warn(`[agent] run ${runId} didn't resume: ${resumed.error.code}`);
        });
      }
    }),
  });
}

/** A key, sign-in or local server changed in main: drop the cached credential, re-read the servers. */
function credentialChangesRouter(container: Container) {
  const os = implementContract(credentialChangesContract);
  return os.router({
    forget: os.forget.handler(async ({ input }) => {
      container.resolve(CredentialProviderToken).forget(input.provider);
      if (container.has(PlanBillingToken)) await container.resolve(PlanBillingToken).refresh();
      audioCredentialsChanged(container, input.provider);
      if (input.provider === INSTAGRAM_PROVIDER && container.has(InstagramSavedStoreToken)) {
        await container.resolve(InstagramSavedStoreToken).clear?.();
        if (container.has(EventBusToken)) {
          container.resolve(EventBusToken).emit('library.changed', {
            projectId: null,
            entity: 'template',
            change: 'updated',
            ids: [],
          });
        }
      }
      if ((LOCAL_SERVER_KINDS as readonly string[]).includes(input.provider)) {
        await syncLocalServers(container.resolve(ModelRuntimeToken), container.resolve(SettingsStoreToken));
      }
    }),
  });
}

export function composeAgent(config: UtilityConfig, options: AgentRootOptions): UtilityRoot {
  const container = createUtilityContainer(config);
  const main = options.main
    ? connectRpc(MAIN_SERVICE_CONTRACTS.agent, options.main, { peer: 'main' }).client
    : undefined;
  if (main) container.value(AgentMainServicesToken, () => main);
  // The hub's install key, asked of main's keychain on each hub write (shared/hub-install-key.ts).
  if (main) container.value(HubInstallKeyToken, () => readHubInstallKey(main.credentials));
  if (main) {
    container.value(InstagramSessionProviderToken, createRpcInstagramSessionProvider(main.credentials));
  }
  container.factory(CommandBusToken, ({ store, clock }) => createCommandBus({ store, clock }), {
    deps: { store: AuditLogStoreToken, clock: ClockToken },
  });
  // Media and vision jobs run in the jobs process; main forwards the runner there. A keyed job outlives
  // a jobs-process restart: the tool asks for it again and waits on (agent-job-runner.ts).
  container.value(
    JobRunnerToken,
    options.jobs ??
      (main ? restartingJobRunner(jobRunnerOverRpc(() => main.runner)) : createDirectJobRunner([])),
  );
  // G8: the usage limits the model client notes (before the client that reports them).
  registerUsageLimits(container);
  registerAgentModels(container, {
    ...(main ? { main: () => main } : {}),
    ...(options.hardware ? { hardware: options.hardware } : {}),
    ...(options.localRuntime ? { localRuntime: options.localRuntime } : {}),
    ...(options.modelClient ? { modelClient: options.modelClient } : {}),
    ...(options.modelRuntime ? { modelRuntime: options.modelRuntime } : {}),
  });
  registerLibraryAgent(container, config);
  // Phase 3's library stores, before everything below that checks for them (library-phase3.ts).
  registerLibraryPhase3Agent(container, config);
  // LRN1-MEM: the memory store, commands, index and ranker, before the agent and its tools (agent-memory.ts).
  registerAgentMemory(container);
  // EDT1-CMT: the comment store and its commands (agent-comments.ts).
  registerAgentComments(container);
  // HFW1-WS: the workspace store, before the tools and commands that use it (workspace-store.ts).
  registerWorkspaceStore(container, config);
  // FIX-GFXWAIT: the templates whose graphics are being designed, which a make from one waits for.
  container.value(TemplateDesignTrackerToken, createTemplateDesignTracker());
  // LRN1-PREF: casting's config source (the learned weights) and the learning job, on memory's store.
  registerCastingPrefs(container);
  // LRN1-STY: style profiles, before the templates router and tools that serve them (agent-style-profiles.ts).
  registerStyleProfiles(container);
  // The make flow's sandbox (job mode) and casting (P2-T2, P2-M2). Casting registers the shot profiles on its
  // own embedding space, so a cast reads vectors only once the space is open (the same cast every time);
  // registerLibraryProfiles then keeps them.
  registerExperimentSandbox(container, config);
  registerTimelineAgent(container);
  // Phase 3 audio: ElevenLabs, the translator, generation services and the speech cleanup source (agent-audio.ts).
  registerAudioAgent(container, config);
  registerLibraryProfiles(container);
  registerAgentFlows(container);
  registerAgentServices(container);
  const creation = registerCreation(container, config);
  const products = registerProducts(container, config);
  registerAgentLoop(container, { soul: options.soul, scratchRoot: scratchRoot(config.userData) });
  registerAgentMcp(container);
  registerRateLimitFollower(container);
  registerExternalRuns(container);

  registerCommands(container, config);
  container.resolve(CommandBusToken).register(...creation.commands, ...products.commands);
  registerAgentTelemetry(container, config.appVersion?.trim() || '0.0.0');

  const os = implementContract(UTILITY_CONTRACTS.agent);
  const router = os.router({
    ...commonRouters(container, 'agent', options.pid ?? process.pid),
    commands: commandsRouter(container.resolve(CommandBusToken)),
    speech: speechRouter(container),
    interfaceSounds: interfaceSoundsRouter(container.resolve(SettingsStoreToken)),
    models: modelsRouter(container.resolve(ModelSettingsToken)),
    usage: usageRouter(container.resolve(UsageStoreToken), container.resolve(UsageLimitsToken)),
    traces: tracesRouter(container.resolve(TraceStoreToken)),
    chat: chatRouter(container.resolve(ChatServiceToken)),
    consents: consentsRouter(consentsService(container.resolve(ConsentStoreToken))),
    runs: runsRouter(container),
    credentials: credentialChangesRouter(container),
    system: systemRouter({
      hardware: container.resolve(HardwareProbeToken),
      compute: ({ assessment }) => {
        const local = container.resolve(LocalRuntimeToken).runtime();
        return computeReport({
          profiles: container.resolve(ModelProfilesToken),
          hardware: assessment,
          ...(local ? { localRuntime: local } : {}),
        });
      },
      // The jobs process manages the components and their download; main forwards them.
      components: async () => (main ? main.components.list() : componentList([])),
      downloads: async () => (main ? main.components.downloads() : NOTHING_TO_DOWNLOAD),
      gpuSetup: async ({ info }) =>
        gpuSetupOf(info.gpus, cudaRuntimeRow(main ? await main.components.list() : []), {
          root: componentsRoot(config.userData),
        }),
    }),
    ...agentPhase2Routers(container),
    ...backgroundModelsRouters(container),
    ...agentPhase3Routers(container),
    ...agentMcpRouters(container),
    // LRN1-MEM serves Settings → Memory from the agent's memory service.
    memory: agentMemoryRouter(container),
    // EDT1-CMT serves the editor's comments over the library's comment store.
    comments: agentCommentsRouter(container),
    // HFW1-UI serves the editor's files viewer over the library's workspace store.
    workspace: agentWorkspaceRouter(container),
    creation: creation.router,
    products: products.router,
    productPublishing: products.publishing,
    productWake: products.wakeRouter,
  });
  const start = async () => {
    unwrapRpc(
      await restoreEditorOwnership(
        fromCoreEventLog(container.resolve(EventLogStoreToken)),
        container.resolve(CommandBusToken).editing,
      ),
    );
    startAgentLoop(container);
    await startAgentMcp(container);
    // Local only is read before the first model call can go out.
    await startAgentServices(container);
    await products.start();
    // The template index follows template writes and catches up with the store (LRN1-TPL).
    startTemplateIndex(container);
    // LRN1-STY: style profiles follow template writes and keep watched collections' profiles built.
    startStyleProfiles(container);
    // HFW1 tpl: a template made from a reel has its graphics designed once, as compositions, in the background.
    startTemplateDesignFor(container, config);
    // HFW1 tpl: a make's composition graphics drawn over its footage and checked; HFW1-DSN: the Designer redesigns
    // one that fails (agent-designer.ts), where it can run; the person's frames go to a cloud model as pictures only
    // under their standing upload consent, else it reads the checks in words.
    startFillChecks(container, templateDesignerOf(container, { frames: 'footage' }));
    // HFW1-WS: blobs nothing names and the folders of projects that are gone, once launch has settled.
    pruneWorkspacesLater(container);
    // LRN1-MEM: the memory index opens, missed exports are recorded, main's are followed.
    await startAgentMemory(container);
    // LRN1-PREF: learn from the log once, then after each person's swap or removal.
    await startCastingPrefs(container);
    // Runs waiting for a model limit when the app quit go on when it lifts.
    await startRateLimitFollower(container);
    const models = await startAgentModels(container);
    await creation.start();
    return models;
  };
  return { container, router, start };
}
