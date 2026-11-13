// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * DI tokens the composition roots use. Core's (ClockToken, EventBusToken,
 * CommandBusToken, SettingsStoreToken, ConversationStoreToken, JobRunnerToken,
 * …) come from @taalcut/core, and the library's (LibraryDatabaseToken,
 * LibraryPortsToken, CommandUnitOfWorkToken) and models' (ModelClientToken,
 * CredentialProviderToken, …) from their packages; they are re-exported here
 * so the roots import tokens from one place. The rest are keyed as their
 * owners will key them, so moving one into its package later changes imports
 * only.
 */
import {
  createToken,
  type AsyncResult,
  type MainServicesClient,
  type ThemeService,
  type ToolModule,
} from '@taalcut/core';
import type { ComponentManager, JobEngine } from '@taalcut/jobs';
import type { ExternalRunner, ToolRegistry } from '@taalcut/tools';
import type { UtilityConfig } from './rpc-ipc';

export { CommandUnitOfWorkToken, LibraryDatabaseToken, LibraryPortsToken } from '@taalcut/library';
export {
  CredentialProviderToken,
  HardwareProbeToken,
  LocalRuntimeToken,
  ModelClientToken,
  ModelProfilesToken,
  ModelRuntimeToken,
  ModelSettingsToken,
  PlanBillingToken,
  type LocalRuntimeSlot,
  type ProbedHardware,
} from '@taalcut/models';

/** Desktop only: what main told this utility process (database path, userData, resources). */
export const UtilityConfigToken = createToken<UtilityConfig>('desktop.utilityConfig');

/** Desktop only: the agent process's client of main's services (credentials, the job runner). */
export const AgentMainServicesToken =
  createToken<() => MainServicesClient<'agent'>>('desktop.agentMainServices');

/** Desktop only: main's theme (nativeTheme and the saved preference). */
export const ThemeServiceToken = createToken<ThemeService>('desktop.themeService');

/** Move to @taalcut/tools. */
export const ToolModulesToken = createToken<readonly ToolModule[]>('tools.modules');
export const ToolRegistryToken = createToken<ToolRegistry>('tools.registry');

/**
 * P3-V4: the agent's external runner (@taalcut/agent's createExternalRunner), which runs an MCP session's calls.
 * Defined once here (typed by @taalcut/tools' port, which the agent's runner implements); registered by
 * roots/agent-external-runs.ts, read by the MCP gateway (roots/agent-mcp.ts).
 */
export const ExternalRunnerToken = createToken<ExternalRunner>('agent.externalRunner');

/** Move to @taalcut/jobs. */
export const JobEngineToken = createToken<JobEngine>('jobs.engine');
export const ComponentManagerToken = createToken<ComponentManager>('jobs.componentManager');
/**
 * EAR1-G2: the member of a component's variant group the download takes here (fp16 on a Metal Mac, the base under
 * TAALCUT_FORCE_CPU), installing nothing: the signed manager's `variantOf`, registered beside the manager.
 */
export const ComponentVariantToken =
  createToken<(id: string) => AsyncResult<string>>('jobs.componentVariant');
