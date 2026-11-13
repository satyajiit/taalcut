// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Core's ProjectBudgetStore (P2-X1): the cap is on the project row (copied
 * from `budget.defaultProjectCap` when project.create runs; projects made
 * before have none); `spent` sums the cost of the project's cloud calls: rows
 * that name the project, and rows of agent runs in the project's
 * conversations (the model call log records the run, not the project).
 * Spend is in US dollars until the agent SPEC settles conversion, so a cap in
 * another currency is refused.
 */
import {
  err,
  moneySchema,
  NotFoundError,
  ok,
  ValidationError,
  type Money,
  type ProjectBudgetStore,
  type ProjectId,
  type Result,
} from '@taalcut/core';
import { eq } from 'drizzle-orm';
import type { LibraryDatabase } from '../db/database';
import { writeWith, type CommandStager } from '../ports/staging';
import { attemptWrite } from '../repositories/shared';
import { projects } from '../schema/chat';

export const SPEND_CURRENCY = 'USD';

export interface BudgetStoreOptions {
  /** createLibraryPorts(db).commands: setCap commits with the command's audit row. */
  readonly commands?: CommandStager;
}

/** The cap columns for a cap (both null: no cap). */
export function capColumns(cap: Money | null): {
  budgetCapMicros: number | null;
  budgetCapCurrency: string | null;
} {
  return { budgetCapMicros: cap?.micros ?? null, budgetCapCurrency: cap?.currency ?? null };
}

/** A cap the store can hold: valid money, not negative, in the spend's currency. */
export function checkCap(cap: Money | null): Result<void> {
  if (cap === null) return ok(undefined);
  if (!moneySchema.safeParse(cap).success || cap.micros < 0) return err(ValidationError({ field: 'cap' }));
  if (cap.currency !== SPEND_CURRENCY)
    return err(
      ValidationError({ field: 'cap' }, { detail: `spend is in ${SPEND_CURRENCY}, not ${cap.currency}` }),
    );
  return ok(undefined);
}

/** Micro-dollars the project's cloud calls cost. */
export function projectSpend(db: LibraryDatabase, projectId: ProjectId): number {
  const row = db.driver
    .prepare(
      `SELECT coalesce(sum(cost_micro_usd), 0) AS spent FROM cloud_calls
       WHERE project_id = ?1
          OR run_id IN (SELECT r.run_id FROM agent_runs r
                        JOIN conversations c ON c.id = r.conversation_id WHERE c.project_id = ?1)`,
    )
    .get(projectId);
  return Number(row?.spent ?? 0);
}

export function createProjectBudgetStore(
  db: LibraryDatabase,
  options: BudgetStoreOptions = {},
): ProjectBudgetStore {
  const { orm } = db;
  const project = (id: ProjectId) => orm.select().from(projects).where(eq(projects.id, id)).get();
  const missing = (id: ProjectId) => err(NotFoundError({ entity: 'project', id }));

  return {
    async get(projectId) {
      const row = project(projectId);
      if (!row) return missing(projectId);
      const cap =
        row.budgetCapMicros !== null && row.budgetCapCurrency !== null
          ? { currency: row.budgetCapCurrency, micros: row.budgetCapMicros }
          : null;
      return ok({ projectId, cap, spent: { currency: SPEND_CURRENCY, micros: projectSpend(db, projectId) } });
    },

    async setCap(projectId, cap, context) {
      const valid = checkCap(cap);
      if (!valid.ok) return valid;
      const saved = writeWith(
        options.commands,
        context,
        () => (project(projectId) ? ok(undefined) : missing(projectId)),
        () =>
          attemptWrite(db, 'project', () =>
            orm.update(projects).set(capColumns(cap)).where(eq(projects.id, projectId)).run(),
          ),
      );
      return saved.ok ? ok(cap) : saved;
    },
  };
}
