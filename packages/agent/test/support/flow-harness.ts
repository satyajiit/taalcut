// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** An agent with the stand-in domain modules composed in, as the agent root composes the real ones. */
import {
  unwrap,
  type AnyTool,
  type ProjectBudgetStore,
  type SkillModule,
  type Telemetry,
  type ToolModule,
} from '@taalcut/core';
import {
  agentSkillModule,
  createSkillRegistry,
  type AgentDeps,
  type AgentSettings,
  type EventLogStore,
  type ModelScript,
} from '@taalcut/agent';
import { harness, registryFor } from './harness';
import { flowSkillModules, type SkillOptions } from './flow-skills';
import { createWorld, flowToolModules, worldRefs, type World } from './flow-world';

export interface FlowHarnessOptions {
  readonly script: ModelScript;
  readonly world?: World;
  readonly skills?: SkillOptions;
  readonly settings?: AgentSettings;
  readonly budgets?: ProjectBudgetStore;
  readonly telemetry?: Telemetry;
  readonly deps?: Partial<AgentDeps>;
  /** A log shared with another agent (a restart, a replay). */
  readonly store?: EventLogStore;
  /** Skill modules left out, as when a domain package isn't installed. */
  readonly without?: readonly string[];
  /** More stand-in tool and skill modules (AGT2: the Maker and the other lanes' tools). */
  readonly extra?: {
    readonly tools?: readonly ToolModule[];
    /** Added to the world's render module (a module id is registered once). */
    readonly renderTools?: readonly AnyTool[];
    readonly skills?: readonly SkillModule[];
  };
}

export function flowHarness(options: FlowHarnessOptions) {
  const world = options.world ?? createWorld();
  const modules = [...flowToolModules(world, options.extra?.renderTools), ...(options.extra?.tools ?? [])];
  const skills = unwrap(
    createSkillRegistry(
      [
        ...flowSkillModules(world, options.skills),
        agentSkillModule(),
        ...(options.extra?.skills ?? []),
      ].filter((m) => !options.without?.includes(m.id)),
      registryFor(modules),
    ),
  );
  const h = harness({
    script: options.script,
    modules,
    ...(options.store ? { store: options.store } : {}),
    settings: { autonomy: 'before-render', ...options.settings },
    deps: {
      skills,
      refs: worldRefs(world),
      flows: { staleAfterMs: 5 },
      ...(options.budgets ? { budgets: options.budgets } : {}),
      ...(options.telemetry ? { telemetry: options.telemetry } : {}),
      ...options.deps,
    },
  });
  return { ...h, world, skills };
}

/** Waits for the watcher's quiet period to pass (it closes a waiting export approval as stale). */
export const settleWatcher = () => new Promise((resolve) => setTimeout(resolve, 30));
