// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Storing what a stage settled on, with dependent invalidation (round IX3): its result (apply-result.ts) or its
 * skip, the digest of what it now stores and the reset of the stages that read it, all in one transaction. A crash
 * leaves all of it or none: the row is still queued or running with its job, and the restarted pipeline's reconcile
 * stores the job's output again, digest and resets included.
 *
 * A skip that clears vector kinds (core `IndexStageSkip.clears`: transcript vectors once a clip turned silent)
 * removes them first, so a crash before the skip is stored leaves a waiting row that clears again.
 */
import {
  ok,
  type AssetId,
  type AssetIndexView,
  type IndexStageDefinition,
  type IndexStageResult,
  type IndexStageSkip,
  type Result,
  type VectorIndex,
} from '@taalcut/core';
import type { LibraryDatabase } from '../db/database';
import { inTransaction } from '../repositories/shared';
import { applyStageResult } from './apply-result';
import type { Invalidation } from './invalidation';
import { createStageRows } from './stage-rows';

export interface StageOutcomeDeps {
  readonly db: LibraryDatabase;
  readonly invalidation: Invalidation;
  /** The active embedding space's index, once there is one (a skip's `clears`). */
  readonly vectors?: (() => VectorIndex | undefined) | undefined;
}

interface StageRun {
  readonly assetId: AssetId;
  readonly stage: string;
  readonly generation: number;
}

export function createStageOutcomes(deps: StageOutcomeDeps) {
  const { db, invalidation } = deps;
  const rows = createStageRows(db);

  function clearVectors(assetId: AssetId, kinds: IndexStageSkip['clears']): Result<unknown> {
    const index = kinds && kinds.length > 0 ? deps.vectors?.() : undefined;
    return index && kinds ? index.removeWhere({ assetId, kind: kinds }) : ok(0);
  }

  return {
    /** The job's result and the stage's `done`, its digest and its readers' resets, in one transaction. */
    succeeded(run: StageRun, result: IndexStageResult, output: unknown, finishedAt?: number): Result<void> {
      return inTransaction(db, 'index_stage', () => {
        const applied = applyStageResult(
          db,
          run.assetId,
          run.stage,
          run.generation,
          result,
          output,
          finishedAt,
        );
        if (applied.ok) invalidation.stored(run.assetId, run.stage);
        return applied;
      });
    },

    /**
     * The stage's `skipped` (after the vectors it clears), its digest and its readers' resets. When the vectors or
     * the rows can't be written, the row fails with the error instead (`indexing.retryFailed` tries again).
     */
    skipped(
      run: StageRun,
      definition: IndexStageDefinition,
      skip: IndexStageSkip,
      view: AssetIndexView,
    ): void {
      const cleared = clearVectors(run.assetId, skip.clears);
      const stored = !cleared.ok
        ? cleared
        : inTransaction(db, 'index_stage', () => {
            rows.skipped(run.assetId, run.stage, skip.skip, definition.version, run.generation);
            invalidation.stored(run.assetId, run.stage, view);
            return ok(undefined);
          });
      if (!stored.ok) rows.failed(run.assetId, run.stage, stored.error);
    },
  };
}

export type StageOutcomes = ReturnType<typeof createStageOutcomes>;
