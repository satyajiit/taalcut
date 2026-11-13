// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `library.reindexAssets` (agent process): bumps each asset's generation and
 * puts the chosen stages back to waiting (default: every stage after
 * library.hash, which identifies the bytes and never needs redoing). A write,
 * not undoable: the analysis is redone, and a job still running for the old
 * generation reports a result the pipeline drops. The pipeline in the jobs
 * process sees the rows on its next poll; no stage definitions are needed here.
 */
import {
  defineCommand,
  err,
  LIBRARY_COMMANDS,
  libraryCommandPayloads,
  NotFoundError,
  ok,
  type AssetId,
  type CommandContext,
  type CommitAnnouncer,
  type Result,
} from '@taalcut/core';
import { inArray } from 'drizzle-orm';
import type { LibraryDatabase } from '../db/database';
import type { CommandUnitOfWork, StagedWrite } from '../ports/unit-of-work';
import { createAssetRepository } from '../repositories/media-library';
import { inTransaction } from '../repositories/shared';
import { assets } from '../schema/library';
import { createStageRows } from './stage-rows';

export const REINDEX_ASSETS = LIBRARY_COMMANDS.reindexAssets;

export interface ReindexCommandDeps {
  readonly db: LibraryDatabase;
  /** createLibraryPorts(db).commands: the write commits with the audit entry. */
  readonly commands?: Pick<CommandUnitOfWork, 'stage'>;
  /** Announces `library.changed` after the staged reset commits. */
  readonly announcer?: Pick<CommitAnnouncer, 'note'>;
}

/** Bumps the generation and resets the stages, in one transaction. Returns how many assets. */
export function reindexAssets(
  db: LibraryDatabase,
  assetIds: readonly AssetId[],
  stages?: readonly string[],
): Result<number> {
  return inTransaction(db, 'asset', () => {
    const bumped = createAssetRepository(db).reindex(assetIds);
    if (!bumped.ok) return bumped;
    createStageRows(db).reset([...bumped.value.keys()], stages);
    return ok(bumped.value.size);
  });
}

export function createReindexCommand(deps: ReindexCommandDeps) {
  const write = (context: CommandContext, change: StagedWrite) =>
    deps.commands ? deps.commands.stage(context, change) : change();

  return defineCommand({
    name: REINDEX_ASSETS,
    payload: libraryCommandPayloads[REINDEX_ASSETS],
    sideEffect: 'write',
    handle: async (payload, context) => {
      const ids = [...new Set(payload.assetIds)] as AssetId[];
      const known = deps.db.orm
        .select({ id: assets.id })
        .from(assets)
        .where(inArray(assets.id, ids))
        .all()
        .map((r) => r.id);
      const unknown = ids.find((id) => !known.includes(id));
      if (unknown) return err(NotFoundError({ entity: 'asset', id: unknown }));
      const staged = write(context, () => reindexAssets(deps.db, ids, payload.stages));
      if (!staged.ok) return staged;
      if (ids.length > 0) {
        deps.announcer?.note(context, { projectId: null, entity: 'asset', change: 'updated', ids });
      }
      // Not undoable: no inverse.
      return ok({ result: { assetIds: ids, stages: payload.stages ?? null } });
    },
  });
}
