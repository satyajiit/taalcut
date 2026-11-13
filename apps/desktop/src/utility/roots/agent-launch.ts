// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Phase 3 (launch) wiring of @taalcut/agent and @taalcut/models in the agent process (models-agent lane):
 * the agent's Phase 3 dependencies (packages/agent SPEC sections 21–29), the tool modules and commands those
 * features add. Each feature keeps its own wiring file and joins here with one line, so agent-loop.ts and
 * agent-root.ts call this file once each.
 */
import {
  SettingsStoreToken,
  SOUL_DIALS_SETTING,
  type AnyCommand,
  type Container,
  type SoulDials,
  type ToolModule,
} from '@taalcut/core';
import { productToolModule, type AgentDeps } from '@taalcut/agent';
import { ProductServiceToken } from '../products/tokens';
import { LocalOnlyFlagToken, SkillRegistryToken } from './agent-flows';
import { flowExtensionDeps } from './agent-gaps';
import { hubToolModules } from './agent-hub-tools';
import { imageToolModules } from './agent-images';
import { limitsAgentDeps } from './agent-limits';
import { localOnlyAgentDeps } from './agent-local-only';
import { memoryAgentDeps, memoryCommands, memoryToolModules } from './agent-memory';
import { commentCommands, commentToolModules } from './agent-comments';
import { workspaceCommands } from './workspace-store';
import { workspaceToolModules } from './agent-workspace-tools';
import { pointerDeps } from './agent-pointers';
import { routerAgentDeps, routerCommands } from './agent-router';
import { soulCommands, soulToolModules } from './agent-soul';

/** Phase 3's tool modules, after the make flow's (agent-loop.ts); apps/gate-demo offers them in this order. */
export function launchToolModules(container: Container): ToolModule[] {
  return [
    ...soulToolModules(container),
    ...imageToolModules(container),
    ...hubToolModules(container),
    // LRN1-MEM: memory.remember, memory.recall (agent-memory.ts).
    ...memoryToolModules(container),
    // EDT1-CMT: comments.list, comments.reply (agent-comments.ts).
    ...commentToolModules(container),
    // HFW1-DSN: the Designer's workspace tools, where the workspace store is (agent-workspace-tools.ts).
    ...workspaceToolModules(container),
    ...(container.has(ProductServiceToken)
      ? [productToolModule(container.resolve(ProductServiceToken))]
      : []),
  ];
}

/** The agent's Phase 3 dependencies (createAgent's `phase3`). */
export function launchAgentDeps(container: Container): Pick<AgentDeps, 'phase3'> {
  const settings = container.resolve(SettingsStoreToken);
  return {
    phase3: {
      // A failed read keeps the defaults: the persona never blocks a run.
      soulDials: async (): Promise<SoulDials> => {
        const read = await settings.get(SOUL_DIALS_SETTING);
        return read.ok ? read.value : SOUL_DIALS_SETTING.defaultValue;
      },
      // What a message points at ("the transition at 0:04"), and the editor a docked one came from (EDT1).
      ...pointerDeps(container),
      // G8: a rateLimit card leaves out the module's other limited models (agent-limits.ts).
      ...limitsAgentDeps(container),
      // P3-B11: the tool router, off until a person turns it on (agent-router.ts).
      ...routerAgentDeps(container),
      // P3-B10: Local only now, and the modules that still run on this Mac (agent-local-only.ts).
      ...localOnlyAgentDeps(container),
      // P3-B8, SPEC section 25: gaps after the Librarian, the voice steps (agent-gaps.ts).
      ...flowExtensionDeps(container, container.resolve(SkillRegistryToken), () =>
        container.resolve(LocalOnlyFlagToken).get(),
      ),
      // LRN1-MEM: what the run remembers, recalled once at its start (agent-memory.ts).
      ...memoryAgentDeps(container),
    },
  };
}

/** Phase 3's commands on the agent process's bus. */
export function launchCommands(container: Container): AnyCommand[] {
  return [
    ...soulCommands(container),
    ...routerCommands(container),
    ...memoryCommands(container),
    // EDT1-CMT: comments.* (agent-comments.ts).
    ...commentCommands(container),
    // HFW1-WS: workspace.writeFiles and workspace.restore (workspace-store.ts).
    ...workspaceCommands(container),
  ];
}
