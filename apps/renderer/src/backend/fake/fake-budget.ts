// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Project budgets' fake (appContract.budget and BUDGET_COMMANDS; the agent
 * serves them in the app over the library's ProjectBudgetStore): the cap a
 * new project gets, and each project's cap and spend. Changing a cap is a
 * person-only command (the bus refuses the agent) and undoable: its inverse
 * puts the previous cap back.
 */
import {
  BUDGET_COMMANDS,
  budgetCommandPayloads,
  defineCommand,
  ok,
  PERSON_SOURCES,
  type AnyCommand,
  type Money,
  type ProjectBudget,
  type ProjectId,
} from '@taalcut/core';

import { FLOW_PROJECT_ID } from './fake-projects';

const usd = (micros: number): Money => ({ currency: 'USD', micros });

export interface FakeBudget {
  defaults(): { projectCap: Money | null };
  project(projectId: ProjectId): ProjectBudget;
  commands(): AnyCommand[];
}

export function createFakeBudget(initial?: { defaultCap?: Money | null; spent?: Money }): FakeBudget {
  let defaultCap: Money | null = initial?.defaultCap === undefined ? usd(2_000_000) : initial.defaultCap;
  const caps = new Map<string, Money | null>();
  // The flow's project has nearly reached the default cap (the budget-cap card's scenario); others less.
  const spentBy: Readonly<Record<string, number>> = {
    [FLOW_PROJECT_ID]: 1_920_000,
    '01K7C5M6Q8R9S0T1V2W3X4Y5ZD': 640_000,
  };
  const spentOn = (projectId: string) => initial?.spent ?? usd(spentBy[projectId] ?? 110_000);

  const setProjectCap = defineCommand({
    name: BUDGET_COMMANDS.setProjectCap,
    payload: budgetCommandPayloads[BUDGET_COMMANDS.setProjectCap],
    sideEffect: 'write',
    sources: PERSON_SOURCES,
    project: ({ projectId }) => projectId,
    handle({ projectId, cap }) {
      const before = caps.has(projectId) ? (caps.get(projectId) ?? null) : defaultCap;
      caps.set(projectId, cap);
      return ok({
        result: cap,
        inverse: { name: BUDGET_COMMANDS.setProjectCap, payload: { projectId, cap: before } },
      });
    },
  });
  const setDefaultCap = defineCommand({
    name: BUDGET_COMMANDS.setDefaultCap,
    payload: budgetCommandPayloads[BUDGET_COMMANDS.setDefaultCap],
    sideEffect: 'write',
    sources: PERSON_SOURCES,
    project: () => null,
    handle({ cap }) {
      const before = defaultCap;
      defaultCap = cap;
      return ok({ result: cap, inverse: { name: BUDGET_COMMANDS.setDefaultCap, payload: { cap: before } } });
    },
  });

  return {
    defaults: () => ({ projectCap: defaultCap }),
    project: (projectId) => ({
      projectId,
      cap: caps.has(projectId) ? (caps.get(projectId) ?? null) : defaultCap,
      spent: spentOn(projectId),
    }),
    commands: () => [setProjectCap, setDefaultCap],
  };
}
