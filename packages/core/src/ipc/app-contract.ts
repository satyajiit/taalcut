// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Everything the renderer can call, by namespace; which process implements
 * each namespace; what each utility process serves to main; and what main
 * serves back to each utility process. Main serves the app contract on the
 * renderer's port: its own namespaces locally, the others forwarded
 * unchanged to the same namespace of the owning process (routeAppContract).
 * See packages/core/SPEC.md, "Routing".
 */
import { chatContract } from '../chat/chat-contract';
import { pluginsContract, pluginsServiceContract, pluginsSetupContract } from '../plugins/plugin-contract';
import { commandsContract } from '../commands/commands-contract';
import { eventsContract } from '../events/events-contract';
import { jobsContract } from '../jobs/job-queue';
import { componentInstallerContract } from '../jobs/components-contract';
import { jobRunnerContract } from '../jobs/job-runner-contract';
import { agentRunsContract, recoveryContract } from '../recovery/recovery';
import { accountsContract } from '../settings/accounts-contract';
import { consentsContract } from '../settings/consents-contract';
import { modelsContract } from '../settings/models-contract';
import { systemContract } from '../settings/system-contract';
import { tracesContract } from '../settings/traces-contract';
import { backgroundModelsContract } from '../ports/background-models';
import { embeddingsContract } from '../ports/embedder';
import { jobEnqueueContract } from '../jobs/job-enqueue-contract';
import { rendersContract } from '../render/renders-contract';
import { renderWorkerContract } from '../render/render-worker-contract';
import { acknowledgementsContract } from '../settings/acknowledgements-contract';
import { templatesContract } from '../templates/templates-contract';
import { timelinesContract } from '../timeline/timelines-contract';
import { usageContract } from '../settings/usage-contract';
import { budgetContract } from '../settings/budget-contract';
import { onboardingContract } from '../settings/onboarding-contract';
import { privacyContract } from '../settings/privacy-contract';
import { telemetryContract, telemetryIngestContract } from '../telemetry/telemetry';
import { indexingContract } from '../library/indexing';
import { importsControlContract } from '../imports/import-control';
import { importsContract } from '../imports/import-contract';
import { libraryContract } from '../library/library-contract';
import { projectsContract } from '../library/projects-contract';
import { transferContract } from '../transfer/transfer-contract';
import { deviceKeysContract } from '../transfer/device-keys-contract';
import { hubContract } from '../hub/hub-contract';
import { mcpContract, mcpSetupContract } from '../mcp/mcp-contract';
import { mcpGatewayContract } from '../mcp/mcp-gateway-contract';
import { mcpSessionsContract } from '../mcp/mcp-sessions-contract';
import { localeContract } from '../settings/locale-contract';
import { speechContract } from '../settings/spoken-languages';
import { interfaceSoundsContract } from '../settings/interface-sounds';
import { stylesContract } from '../styles/styles-contract';
import { voiceCaptureContract, voiceCaptureFilesContract } from './voice-capture-contract';
import { memoryContract } from '../memory/memory-contract';
import { commentsContract } from '../comments/comments-contract';
import { workspaceContract } from '../workspace/workspace-contract';
import { creationContract } from '../creation/creation-contract';
import { productContract } from '../products/product-contract';
import { productPublishingContract } from '../products/product-publishing-contract';
import {
  productBackgroundContract,
  productBackgroundControlContract,
  productWakeContract,
} from '../products/product-background';
import { debugBundleContract } from './debug-bundle-contract';
import { crashesContract, feedbackContract, filesContract, updatesContract } from './main-services-contracts';
import type { AnyContractRouter, RpcClient } from './contract';
import { credentialChangesContract, credentialsContract } from './credentials-contract';
import { diagnosticsContract } from './diagnostics-contract';
import { powerContract } from './power-contract';
import type { ProcessName, UtilityName } from './processes';
import { themeContract } from './theme-contract';
import { windowContract } from './window-contract';

export { PROCESS_NAMES, UTILITY_NAMES, type ProcessName, type UtilityName } from './processes';

/**
 * What each utility process serves on its port to main. Every process serves
 * diagnostics and its event bus (main bridges the events into its own bus).
 * Besides the app namespaces it owns (APP_ROUTES), the agent takes credential
 * changes and run resumes from main, and jobs takes power snapshots, runs
 * job kinds and installs components for the agent (`runner`, `components`,
 * forwarded by main), and embeds query text for the agent (`embeddings`).
 */
export const UTILITY_CONTRACTS = {
  agent: {
    creation: creationContract,
    products: productContract,
    productWake: productWakeContract,
    productPublishing: productPublishingContract,
    diagnostics: diagnosticsContract,
    events: eventsContract,
    commands: commandsContract,
    models: modelsContract,
    usage: usageContract,
    traces: tracesContract,
    chat: chatContract,
    consents: consentsContract,
    runs: agentRunsContract,
    credentials: credentialChangesContract,
    system: systemContract,
    templates: templatesContract,
    timelines: timelinesContract,
    acknowledgements: acknowledgementsContract,
    budget: budgetContract,
    privacy: privacyContract,
    onboarding: onboardingContract,
    /** LIB1-LANG: the languages you speak (settings/spoken-languages.ts). */
    speech: speechContract,
    interfaceSounds: interfaceSoundsContract,
    /** LRN1-MEM: Settings → Memory. */
    memory: memoryContract,
    telemetry: telemetryContract,
    /** Every other process's telemetry events, for the agent's queue (main forwards them). */
    telemetryIngest: telemetryIngestContract,
    /** The agent's redacted sections of a debug bundle, for main. */
    debugBundle: debugBundleContract,
    library: libraryContract,
    projects: projectsContract,
    /** Model calls for the jobs process's background work (vision's descriptions), forwarded by main. */
    backgroundModels: backgroundModelsContract,
    /** P3-V10. */
    styles: stylesContract,
    /** P3-B12. */
    hub: hubContract,
    /** P3-V4: Settings › External agents. */
    mcp: mcpContract,
    /** P3-V4: the mcp process's tools and calls, forwarded by main. */
    mcpGateway: mcpGatewayContract,
    /** P3-V4: main hands over a bearer's hash after minting it; main's alone, never forwarded. */
    mcpSessions: mcpSessionsContract,
    /** EDT1-CMT: the editor's comments. */
    comments: commentsContract,
    /** HFW1-UI: the editor's files viewer, read-only, over the workspace store. */
    workspace: workspaceContract,
  },
  jobs: {
    diagnostics: diagnosticsContract,
    events: eventsContract,
    jobs: jobsContract,
    power: powerContract,
    runner: jobRunnerContract,
    components: componentInstallerContract,
    /** Query embeddings for the agent (library search, casting), forwarded by main. */
    embeddings: embeddingsContract,
    /** Enqueue without waiting, for the agent's render.export (forwarded by main). */
    queue: jobEnqueueContract,
    /** The jobs process's redacted sections of a debug bundle, for main. */
    debugBundle: debugBundleContract,
    /** The library's indexing pipeline runs here, beside the queue it schedules. */
    indexing: indexingContract,
  },
  render: {
    diagnostics: diagnosticsContract,
    events: eventsContract,
    renders: rendersContract,
    /** Exports for the jobs process, frames for the agent (forwarded by main). */
    worker: renderWorkerContract,
  },
  lan: { diagnostics: diagnosticsContract, events: eventsContract, transfer: transferContract },
  /** P3-V4: the local MCP server, started only while external agents are on. */
  mcp: { diagnostics: diagnosticsContract, events: eventsContract },
} as const satisfies Record<UtilityName, AnyContractRouter>;

export type UtilityContracts = typeof UTILITY_CONTRACTS;
export type UtilityClient<P extends UtilityName> = RpcClient<UtilityContracts[P]>;

/**
 * What main serves each utility process on a second port, the other way
 * round: the agent's credentials (main's AuthBroker), the job runner and
 * component installs (forwarded to the jobs process). Never reachable from a
 * page.
 */
export const MAIN_SERVICE_CONTRACTS = {
  agent: {
    productBackground: productBackgroundControlContract,
    importsControl: importsControlContract,
    plugins: pluginsServiceContract,
    credentials: credentialsContract,
    runner: jobRunnerContract,
    components: componentInstallerContract,
    /** The jobs process's embedder (forwarded). */
    embeddings: embeddingsContract,
    /** The jobs process's queue, to start an export without waiting (forwarded). */
    queue: jobEnqueueContract,
    /** The render process's worker, to capture frames for the Reviewer (forwarded). */
    render: renderWorkerContract,
    /** P3-B6: a voice consent's recording, claimed once from main's capture folder. */
    voiceCaptureFiles: voiceCaptureFilesContract,
    /**
     * LRN1-MEM: main's bus, exposing only `render.finished`, so the agent records what worked when an export finishes.
     * The agent reads it and never publishes it on its own bus, so nothing loops back to main.
     */
    mainEvents: eventsContract,
  },
  jobs: {
    /** The render process's worker, which runs the render.export job (forwarded). */
    render: renderWorkerContract,
    /** The agent's telemetry queue (forwarded to agent.telemetryIngest). */
    telemetry: telemetryIngestContract,
    /** The agent's background model calls (forwarded to agent.backgroundModels). */
    models: backgroundModelsContract,
  },
  render: {
    telemetry: telemetryIngestContract,
    /**
     * P3-V17, P3-V2 (round P3-3): an export's `vision.bakeGrade` and `render.trackSubjects` through the jobs queue
     * (forwarded, as `agent.runner`). Pass the export's job id as `parentJobId`: the export holds the 'gpu' slot.
     */
    runner: jobRunnerContract,
    /** AGT2-MATCH: the jobs process's query embedder (forwarded), for QA's slot match to read a slot's needs. */
    embeddings: embeddingsContract,
  },
  /** P3-B5: the adb key from main's keychain vault. */
  lan: { telemetry: telemetryIngestContract, deviceKeys: deviceKeysContract },
  /** P3-V4: the agent's gateway (forwarded) and the telemetry queue. */
  mcp: { gateway: mcpGatewayContract, telemetry: telemetryIngestContract },
} as const satisfies Record<UtilityName, AnyContractRouter>;

export type MainServiceContracts = typeof MAIN_SERVICE_CONTRACTS;
export type MainServicesClient<P extends UtilityName> = RpcClient<MainServiceContracts[P]>;

export const appContract = {
  creation: creationContract,
  products: productContract,
  productPublishing: productPublishingContract,
  productBackground: productBackgroundContract,
  plugins: pluginsContract,
  pluginsSetup: pluginsSetupContract,
  theme: themeContract,
  /** The caller's own window: the app's window bar and traffic controls. */
  window: windowContract,
  commands: commandsContract,
  events: eventsContract,
  jobs: jobsContract,
  /** Main answers `main` and forwards the others to those processes' diagnostics. */
  diagnostics: {
    main: diagnosticsContract,
    agent: diagnosticsContract,
    jobs: diagnosticsContract,
    render: diagnosticsContract,
  },
  chat: chatContract,
  consents: consentsContract,
  recovery: recoveryContract,
  models: modelsContract,
  accounts: accountsContract,
  usage: usageContract,
  system: systemContract,
  traces: tracesContract,
  renders: rendersContract,
  templates: templatesContract,
  timelines: timelinesContract,
  acknowledgements: acknowledgementsContract,
  budget: budgetContract,
  privacy: privacyContract,
  onboarding: onboardingContract,
  /** LIB1-LANG: the languages you speak. */
  speech: speechContract,
  interfaceSounds: interfaceSoundsContract,
  telemetry: telemetryContract,
  feedback: feedbackContract,
  updates: updatesContract,
  crashes: crashesContract,
  files: filesContract,
  library: libraryContract,
  imports: importsContract,
  indexing: indexingContract,
  projects: projectsContract,
  transfer: transferContract,
  // Phase 3 contract (round P3-1).
  styles: stylesContract,
  hub: hubContract,
  mcp: mcpContract,
  mcpSetup: mcpSetupContract,
  locale: localeContract,
  voiceCapture: voiceCaptureContract,
  // Learning round 1.
  memory: memoryContract,
  // Editor round 1 (EDT1-CMT): comments on a timeline; changes are COMMENT_COMMANDS.
  comments: commentsContract,
  // HyperFrames workspace round 1 (HFW1-UI): a project's workspace files, read-only; changes are WORKSPACE_COMMANDS.
  workspace: workspaceContract,
};

export type AppContract = typeof appContract;
export type AppClient = RpcClient<AppContract>;

/**
 * Owner of each app namespace. A namespace owned by a utility process must be
 * in that process's UTILITY_CONTRACTS entry under the same key (checked in
 * test/app-wiring.test.ts). The command bus sits with the agent because the
 * agent dispatches most commands and writes the audit log; accounts with
 * main, which holds the keychain; recovery with main, which opens the
 * database; system with the agent, which has the model profiles and the
 * embedded runtime (it asks the jobs process for the component list);
 * consents with the agent, which asks for upload consent and keeps it.
 */
export const APP_ROUTES = {
  creation: 'agent',
  products: 'agent',
  productPublishing: 'agent',
  productBackground: 'main',
  plugins: 'main',
  pluginsSetup: 'main',
  theme: 'main',
  window: 'main',
  events: 'main',
  diagnostics: 'main',
  commands: 'agent',
  jobs: 'jobs',
  chat: 'agent',
  consents: 'agent',
  recovery: 'main',
  models: 'agent',
  accounts: 'main',
  usage: 'agent',
  system: 'agent',
  traces: 'agent',
  renders: 'render',
  templates: 'agent',
  timelines: 'agent',
  acknowledgements: 'agent',
  budget: 'agent',
  privacy: 'agent',
  onboarding: 'agent',
  speech: 'agent',
  interfaceSounds: 'agent',
  telemetry: 'agent',
  feedback: 'main',
  updates: 'main',
  crashes: 'main',
  files: 'main',
  library: 'agent',
  imports: 'main',
  indexing: 'jobs',
  projects: 'agent',
  transfer: 'lan',
  styles: 'agent',
  hub: 'agent',
  mcp: 'agent',
  mcpSetup: 'main',
  locale: 'main',
  voiceCapture: 'main',
  memory: 'agent',
  comments: 'agent',
  workspace: 'agent',
} as const satisfies Record<keyof AppContract, ProcessName>;

export type AppRoutes = typeof APP_ROUTES;

/** The namespaces main implements itself. */
export type MainNamespace = {
  [K in keyof AppContract]: AppRoutes[K] extends 'main' ? K : never;
}[keyof AppContract];

/** The app namespaces a utility process owns, which its contract must serve unchanged. */
export type RoutedTo<P extends UtilityName> = {
  [K in keyof AppContract as AppRoutes[K] extends P ? K : never]: AppContract[K];
};
