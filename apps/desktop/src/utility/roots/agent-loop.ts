// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The agent loop in the agent process, composed as apps/gate-demo does it:
 * the tool modules (library, media, vision, then the make flow's:
 * agent-make-tools.ts), the agent over the library's
 * run log, traces and settings, and the chat service the renderer's chat
 * talks to. Media and vision tools run their heavy steps as jobs in the
 * jobs process (JobRunnerToken: over main's port).
 */
import { stat } from 'node:fs/promises';
import {
  ChatServiceToken,
  CommandBusToken,
  ConversationStoreToken,
  createToken,
  EventBusToken,
  EventLogStoreToken,
  JobRunnerToken,
  SettingsStoreToken,
  StyleStoreToken,
  TraceStoreToken,
  TimelineStoreToken,
  MODEL_MODULE_IDS,
  type Container,
  type ModelModuleId,
} from '@taalcut/core';
import {
  createAgent,
  createChatService,
  createCommandDispatcher,
  createConversationTitler,
  createSettingsConsentStore,
  fromCoreEventLog,
  type Agent,
} from '@taalcut/agent';
import { libraryToolModule } from '@taalcut/library';
import { mediaToolModule } from '@taalcut/media';
import { eyesToolModules, withLibraryEyes } from '@taalcut/render';
import { createToolRegistry, editorHistoryTools } from '@taalcut/tools';
import { visionToolModule } from '@taalcut/vision';
import {
  LibraryDatabaseToken,
  LibraryPortsToken,
  ModelClientToken,
  ModelProfilesToken,
  ModelRuntimeToken,
  ToolModulesToken,
  ToolRegistryToken,
} from '../../shared/tokens';
import { moduleContextWindow, moduleSeesImages } from './model-windows';
import { agentFlowDeps, chatProjectLink, projectCapDeps } from './agent-flows';
import { commentChatDeps } from './agent-comments';
import { launchAgentDeps, launchToolModules } from './agent-launch';
import { registerSoul, SoulToken } from './agent-soul';
import { ConsentStoreToken } from './agent-consent-token';
import { critiqueUploadNames } from './agent-listen-cloud';
import { eyesDepsOf, footagePicturesOf } from './agent-eyes';
import { makeFlowToolModules } from './agent-make-tools';
import { agentPluginTools } from './agent-plugins';
import { libraryToolDeps, LibrarySearchToken } from './library-agent';
import { editorCatalogueTool } from '@taalcut/tools';
import { editorCapabilities } from './editor-capabilities';
import { editorReceiptVerifier } from './editor-receipt-verifier';
import { shortsAgentToolModule } from './agent-shorts';
import { repairFlowProjectNames, syncConversationProjectName } from './project-naming';

export const AgentToken = createToken<Agent>('agent.agent');

const isModule = (module: string): module is ModelModuleId =>
  (MODEL_MODULE_IDS as readonly string[]).includes(module);

/** Standing upload consents ("Always allow"): the token is its own file's, for the pictures rule (agent-eyes.ts). */
export { ConsentStoreToken };

/**
 * The agent's tool modules and their registry. In the gate demo's order (apps/gate-demo/test/compose.ts): its
 * recorded sessions offer the same tools, and test/agent-catalogue.test.ts holds this list to the catalogue they
 * were recorded with.
 */
function registerToolRegistry(container: Container): void {
  container.factory(
    ToolModulesToken,
    ({ db, jobs, models, profiles, runtime, search }) => [
      // AGT2: library.frameAt and library.subjects (render's eyes) join the library's module.
      withLibraryEyes(
        libraryToolModule(libraryToolDeps(db, search, { container, pictures: footagePicturesOf(container) })),
        eyesToolModules(eyesDepsOf(container)),
      ),
      mediaToolModule({ jobs }),
      visionToolModule(
        { jobs, models, selector: profiles, runtime },
        // P3-V17: a reference's look as a Style, once the library keeps Styles (library-phase3.ts).
        container.has(StyleStoreToken)
          ? { matchLook: { styles: container.resolve(StyleStoreToken), jobs } }
          : {},
      ),
      ...makeFlowToolModules(container),
      editorHistoryTools(container.resolve(CommandBusToken)),
      editorCatalogueTool(() =>
        editorCapabilities((name) => container.resolve(ToolRegistryToken).resolve(name) !== undefined),
      ),
      // Phase 3's (agent-launch.ts): after the make flow's, so the recorded sessions' tool order holds.
      ...launchToolModules(container),
      shortsAgentToolModule(container),
      ...agentPluginTools(container),
    ],
    {
      deps: {
        db: LibraryDatabaseToken,
        jobs: JobRunnerToken,
        models: ModelClientToken,
        profiles: ModelProfilesToken,
        runtime: ModelRuntimeToken,
        search: LibrarySearchToken,
      },
    },
  );
  container.factory(
    ToolRegistryToken,
    ({ modules }) => {
      const registry = createToolRegistry(modules);
      // A bug in a module (the module and its reason in the message), never a runtime condition.
      if (!registry.ok) {
        const { code, params, detail } = registry.error;
        throw new Error(`Tool modules don't register: ${code} ${JSON.stringify(params)} ${detail ?? ''}`);
      }
      return registry.value;
    },
    { deps: { modules: ToolModulesToken } },
  );
}

export function registerAgentLoop(
  container: Container,
  options: { readonly soul: string; readonly scratchRoot?: string },
): void {
  // SOUL.md v1, read strictly: the agent doesn't start without its persona (agent-soul.ts).
  registerSoul(container, options.soul);
  registerToolRegistry(container);
  container.factory(ConsentStoreToken, ({ settings }) => createSettingsConsentStore(settings), {
    deps: { settings: SettingsStoreToken },
  });
  const windows = moduleContextWindow(container);
  const seeing = moduleSeesImages(container);
  container.factory(
    AgentToken,
    ({ models, tools, log, bus, consents, traces, profiles, runtime, ports }) =>
      createAgent({
        models,
        tools,
        log: fromCoreEventLog(log),
        traces,
        soul: container.resolve(SoulToken),
        commands: createCommandDispatcher(bus, editorReceiptVerifier(container.resolve(TimelineStoreToken))),
        editing: bus.editing,
        // Large tool outputs, by reference: files under the library's folder (pruned at start).
        artifacts: ports.artifacts,
        consents,
        // The providers a module's chain may send to now, for consent cards and standing consents.
        cloudProviders: (module) =>
          isModule(module)
            ? profiles
                .effective(module)
                .chain.filter((choice) => !runtime.isLocalProvider(choice.provider))
                .map((choice) => choice.provider)
            : [],
        // A breakdown's reel and its frames: sent without a consent card, because making a template sends them.
        ...(options.scratchRoot ? { scratchRoot: options.scratchRoot } : {}),
        // A call naming only files that aren't there can't send them: no consent card, the tool's own error.
        fileExists: async (file) => (await stat(file).catch(() => undefined)) !== undefined,
        // EAR1-R3: a sound named by id (audio.cloudCritique) shows on its consent card by name, never by path.
        uploadNames: critiqueUploadNames(container),
        // Skills, the project cap, prices, telemetry, flow projects and ref versions (agent-flows.ts).
        ...agentFlowDeps(container),
        // Phase 3: the soul's dials and the other launch features (agent-launch.ts).
        ...launchAgentDeps(container),
        // AGT1: a prompt is condensed to fit the smallest window in its module's chain (agent SPEC "Compaction").
        contextWindow: (module) => (isModule(module) ? windows(module) : undefined),
        // HFW1: a tool's pictures go as images to a chain whose every model takes them (tool-images.ts).
        seesImages: (module) => isModule(module) && seeing(module),
      }),
    {
      deps: {
        models: ModelClientToken,
        tools: ToolRegistryToken,
        log: EventLogStoreToken,
        bus: CommandBusToken,
        consents: ConsentStoreToken,
        traces: TraceStoreToken,
        profiles: ModelProfilesToken,
        runtime: ModelRuntimeToken,
        ports: LibraryPortsToken,
      },
    },
  );
  container.factory(
    ChatServiceToken,
    ({ agent, conversations, models, events }) =>
      createChatService({
        agent,
        conversations,
        // Global observers still receive completed work after the person leaves the chat.
        onToolFinished: ({ payload }) => events.emit('agent.toolFinished', payload),
        // A chat is named after its first exchange, through the profile's models (logged like any call),
        // within the conversation's project cap.
        titles: createConversationTitler(models, projectCapDeps(container)),
        onConversationNamed: ({ id, title }) => syncConversationProjectName(container, id, title),
        // The editor dock's new chat joins the project its first message's chips name.
        linkProject: chatProjectLink(container),
        // EDT1-CMT: "Send N comments to Taalcut" (agent-comments.ts).
        ...commentChatDeps(container),
        // The sidebar and the window bar read the title again.
        onConversationChanged: ({ id }) =>
          events.emit('library.changed', {
            projectId: null,
            entity: 'conversation',
            change: 'updated',
            ids: [id],
          }),
      }),
    {
      deps: {
        agent: AgentToken,
        conversations: ConversationStoreToken,
        models: ModelClientToken,
        events: EventBusToken,
      },
      // createChatService's service also has close(): stop following runs.
      dispose: (chat) => (chat as Partial<{ close(): void }>).close?.(),
    },
  );
}

/** At start: drop expired and over-cap artifacts, and files a crash left behind. */
export function startAgentLoop(container: Container): void {
  const pruned = container.resolve(LibraryPortsToken).artifacts.prune();
  if (!pruned.ok) console.warn(`[agent] artifacts not pruned: ${pruned.error.code}`);
  void repairFlowProjectNames(container).catch(() => {
    console.warn('[project-naming] Could not reconcile project titles.');
  });
}
