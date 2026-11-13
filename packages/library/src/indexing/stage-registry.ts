// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The stages the jobs process's pipeline runs, as data any process can read
 * (`index_stages`, migration 26): their pipeline order and the finish line
 * each counts toward. Only the jobs process has the stage definitions; the
 * agent process's import status and asset page read this instead, so they
 * show the same order and milestones. The pipeline rewrites it whole at start.
 */
import {
  indexStageMilestone,
  type IndexMilestone,
  type IndexStageDefinition,
  type Result,
} from '@taalcut/core';
import { asc } from 'drizzle-orm';
import type { LibraryDatabase } from '../db/database';
import { attemptWrite } from '../repositories/shared';
import { indexStages } from '../schema/media';

export interface StageRegistry {
  /** Stage names in pipeline order; empty until a pipeline registered its stages. */
  readonly order: readonly string[];
  /** Each registered stage's milestone; a stage missing here is one no pipeline runs. */
  readonly milestones: ReadonlyMap<string, IndexMilestone>;
}

/** Replaces the registry with these stages, in the order given (the pipeline's). */
export function registerIndexStages(
  db: LibraryDatabase,
  stages: readonly Pick<IndexStageDefinition, 'stage' | 'milestone'>[],
): Result<void> {
  return attemptWrite(db, 'index_stage', () =>
    db.transaction(() => {
      db.orm.delete(indexStages).run();
      if (stages.length === 0) return;
      db.orm
        .insert(indexStages)
        .values(
          stages.map((stage, position) => ({
            stage: stage.stage,
            position,
            milestone: indexStageMilestone(stage),
          })),
        )
        .run();
    }),
  );
}

export function readStageRegistry(db: LibraryDatabase): StageRegistry {
  const rows = db.orm
    .select({ stage: indexStages.stage, milestone: indexStages.milestone })
    .from(indexStages)
    .orderBy(asc(indexStages.position))
    .all();
  return {
    order: rows.map((row) => row.stage),
    milestones: new Map(rows.map((row) => [row.stage, row.milestone])),
  };
}

/** `{ milestone }` when the registry knows the stage, else nothing (the contract's "unknown"). */
export function milestoneOf(
  registry: StageRegistry,
  stage: string,
): { readonly milestone: IndexMilestone } | Record<string, never> {
  const milestone = registry.milestones.get(stage);
  return milestone ? { milestone } : {};
}
