// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The project budget's commands and namespace (P2-X1, G8; core's
 * settings/budget-contract.ts). Only a person may raise what Taalcut may
 * spend: both commands take PERSON_SOURCES, so the bus refuses the agent and
 * MCP clients, on dispatch, undo and redo. Both are undoable: the inverse puts
 * the previous cap back. The library implements the store; the agent serves
 * `appContract.budget` from it.
 */
import {
  BUDGET_COMMANDS,
  budgetCommandPayloads,
  budgetContract,
  DEFAULT_PROJECT_CAP_SETTING,
  defineCommand,
  implementContract,
  ok,
  PERSON_SOURCES,
  unwrapRpc,
  type AsyncResult,
  type Money,
  type ProjectBudget,
  type ProjectBudgetStore,
  type ProjectId,
  type SettingsStore,
} from '@taalcut/core';

export interface BudgetDeps {
  readonly budgets: ProjectBudgetStore;
  readonly settings: SettingsStore;
}

/** `project.setBudgetCap` and `budget.setDefaultCap`: person-only, undoable. */
export function createBudgetCommands(deps: BudgetDeps) {
  const setProjectCap = defineCommand({
    name: BUDGET_COMMANDS.setProjectCap,
    payload: budgetCommandPayloads[BUDGET_COMMANDS.setProjectCap],
    sideEffect: 'write',
    sources: PERSON_SOURCES,
    async handle({ projectId, cap }, context) {
      const before = await deps.budgets.get(projectId);
      if (!before.ok) return before;
      // Commits with this command's audit row (undo and redo too), not before it.
      const saved = await deps.budgets.setCap(projectId, cap, context);
      if (!saved.ok) return saved;
      return ok({
        result: { projectId, cap: saved.value },
        inverse: { name: BUDGET_COMMANDS.setProjectCap, payload: { projectId, cap: before.value.cap } },
      });
    },
  });

  const setDefaultCap = defineCommand({
    name: BUDGET_COMMANDS.setDefaultCap,
    payload: budgetCommandPayloads[BUDGET_COMMANDS.setDefaultCap],
    sideEffect: 'write',
    sources: PERSON_SOURCES,
    project: () => null,
    async handle({ cap }, context) {
      const before = await deps.settings.get(DEFAULT_PROJECT_CAP_SETTING);
      if (!before.ok) return before;
      const saved = await deps.settings.set(DEFAULT_PROJECT_CAP_SETTING, cap, context);
      if (!saved.ok) return saved;
      return ok({
        result: { cap: saved.value },
        inverse: { name: BUDGET_COMMANDS.setDefaultCap, payload: { cap: before.value } },
      });
    },
  });

  return { setProjectCap, setDefaultCap, all: [setProjectCap, setDefaultCap] };
}

/** What `appContract.budget` reads. */
export interface BudgetService {
  project(input: { readonly projectId: ProjectId }): AsyncResult<ProjectBudget>;
  defaults(): AsyncResult<{ projectCap: Money | null }>;
}

export function createBudgetService(deps: BudgetDeps): BudgetService {
  return {
    project: ({ projectId }) => deps.budgets.get(projectId),
    async defaults() {
      const cap = await deps.settings.get(DEFAULT_PROJECT_CAP_SETTING);
      return cap.ok ? ok({ projectCap: cap.value }) : cap;
    },
  };
}

/** appContract.budget (owner agent). Changes are BUDGET_COMMANDS. */
export function budgetRouter(service: BudgetService) {
  const os = implementContract(budgetContract);
  return os.router({
    project: os.project.handler(async ({ input }) => unwrapRpc(await service.project(input))),
    defaults: os.defaults.handler(async () => unwrapRpc(await service.defaults())),
  });
}
