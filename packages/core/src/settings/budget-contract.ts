// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The project budget (P2-X1, G8): every project has a spending cap
 * (`budget.defaultProjectCap` when it is created; null means no cap, the
 * user's choice). The library implements the store (the cap on the project
 * row, spent summed from the cloud-call rows of the project's runs); the
 * agent checks it before paid work and serves `appContract.budget`. Changes
 * are the BUDGET_COMMANDS, which only a person may dispatch: define them
 * with `sources: PERSON_SOURCES` (handlers in @taalcut/agent, over this
 * store and DEFAULT_PROJECT_CAP_SETTING).
 */
import '../basics/zod-config';
import { z } from 'zod';
import { idSchema, type ProjectId } from '../basics/ids';
import { moneySchema, type Money } from '../basics/money';
import type { AsyncResult } from '../basics/result';
import type { CommandContext } from '../commands/definition';
import { createToken } from '../di/token';
import { ipc } from '../ipc/contract';
import { defineSetting } from '../ports/preferences';

/** The cap a new project gets: US$2.00. */
export const DEFAULT_PROJECT_CAP_SETTING = defineSetting('budget.defaultProjectCap', moneySchema.nullable(), {
  currency: 'USD',
  micros: 2_000_000,
});

export const projectBudgetSchema = z.object({
  projectId: idSchema<'Project'>(),
  /** null: no cap, the user's choice. */
  cap: moneySchema.nullable(),
  /** CloudCall cost of the project's runs plus paid tool usage. */
  spent: moneySchema,
});
export type ProjectBudget = z.output<typeof projectBudgetSchema>;

export interface ProjectBudgetStore {
  get(projectId: ProjectId): AsyncResult<ProjectBudget>;
  /** With a command's context the write commits with its audit row, as SettingsStore.set does. */
  setCap(projectId: ProjectId, cap: Money | null, context: CommandContext): AsyncResult<Money | null>;
}

export const ProjectBudgetStoreToken = createToken<ProjectBudgetStore>('core.projectBudgetStore');

export const BUDGET_COMMANDS = {
  /** write, undoable (inverse: the previous cap); person sources only. */
  setProjectCap: 'project.setBudgetCap',
  /** write, app-wide, undoable; person sources only. */
  setDefaultCap: 'budget.setDefaultCap',
} as const;

export const budgetCommandPayloads = {
  [BUDGET_COMMANDS.setProjectCap]: z.object({
    projectId: idSchema<'Project'>(),
    cap: moneySchema.nullable(),
  }),
  [BUDGET_COMMANDS.setDefaultCap]: z.object({ cap: moneySchema.nullable() }),
};

/** appContract.budget, owner agent. Changes are BUDGET_COMMANDS. */
export const budgetContract = {
  project: ipc.input(z.object({ projectId: idSchema<'Project'>() })).output(projectBudgetSchema),
  defaults: ipc.output(z.object({ projectCap: moneySchema.nullable() })),
};
