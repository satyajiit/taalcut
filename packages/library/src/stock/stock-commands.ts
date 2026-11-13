// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `library.importStock` reads the cached rendition and enqueues `library.stockImport`.
 * It does not search again and does not read the API key. Without an http port
 * it refuses instead of leaving a job nothing will run. `discardStockImport` is
 * the inverse: internal, and it keeps the file when a timeline still uses it.
 *
 * The job row and the import record are staged on the command's unit of work, so
 * they commit in the audit row's transaction (as `library.addSource`'s scan does):
 * a crash before the append leaves no queued download the undo stack can't see.
 */
import {
  ConflictError,
  defineCommand,
  err,
  LIBRARY_COMMANDS,
  libraryCommandPayloads,
  LocalOnly,
  newId,
  ok,
  type AssetId,
  type AsyncResult,
  type CommandContext,
  type CommandOutcome,
  type JobId,
  type Result,
  type StockImportId,
} from '@taalcut/core';
import type { LibraryDatabase } from '../db/database';
import type { CommandUnitOfWork, StagedWrite } from '../ports/unit-of-work';
import { createJobRepository } from '../repositories/jobs';
import { inTransaction } from '../repositories/shared';
import { enqueueInTransaction } from '../sources/enqueue';
import { StockUnavailable } from '../errors';
import { classifyLicence } from './licences';
import { readLocalOnly } from './local-only';
import { removeStockFile } from './stock-download';
import { createSqliteStockCache, type StockCache } from './search-cache';
import {
  discardImportedAsset,
  existingStockAsset,
  managedFilePath,
  readImportRecord,
  stockImportJob,
  stockImportKey,
  timelineUsesAsset,
  writeImportRecord,
  type ImportRecord,
} from './stock-import';
import { resolveCachedRendition, type ResolvedRendition } from './stock-search';
import type { StockHttp } from './stock-provider';
import type { z } from 'zod';

const C = LIBRARY_COMMANDS;
const P = libraryCommandPayloads;

type ImportResult = {
  importId: StockImportId;
  jobId: JobId | null;
  assetId: AssetId | null;
};

type DiscardResult = { removed: true } | { removed: false; reason: 'inUse' };

type ImportPayload = z.output<(typeof P)[typeof C.importStock]>;
type RecordRest = Omit<ImportRecord, 'importId'>;

export interface StockCommandPorts {
  readonly http?: StockHttp;
  readonly cache?: StockCache;
  readonly clock?: () => number;
  /** Default: the `privacy.localOnly` setting (readLocalOnly: off when unset, on when unreadable). */
  readonly localOnly?: () => boolean;
  /** Default: a row in `timeline_asset_refs`. */
  readonly inUse?: (assetId: AssetId) => boolean;
  /**
   * The command unit of work: the job row and the import record commit with the audit row. Without it (a
   * handler run outside the bus) they are written now, in one transaction.
   */
  readonly commands?: Pick<CommandUnitOfWork, 'stage' | 'handle'>;
}

/**
 * Stages the download job under `jobId`, then `andThen` (the import record). Another import that queued its own
 * download of the item meanwhile rolls the whole command back.
 */
function queueDownload(
  db: LibraryDatabase,
  payload: ImportPayload,
  resolved: ResolvedRendition,
  jobId: JobId,
  andThen: StagedWrite,
): StagedWrite {
  const input = {
    importId: payload.importId,
    item: payload.item,
    projectId: payload.projectId,
    url: resolved.url,
    licence: resolved.licence,
    rawLicence: resolved.rawLicence,
    author: resolved.author,
    authorUrl: resolved.authorUrl,
    sourceUrl: resolved.sourceUrl,
    title: resolved.title,
    attribution: resolved.attribution,
  };
  return () => {
    const enqueued = enqueueInTransaction(db, {
      kind: stockImportJob,
      projectId: payload.projectId,
      id: jobId,
      input,
    });
    if (!enqueued.ok) return enqueued;
    if (enqueued.value.job.id !== jobId)
      return err(ConflictError({ entity: 'job', id: jobId }, { detail: 'another import queued it' }));
    return andThen();
  };
}

interface ImportDeps {
  readonly db: LibraryDatabase;
  readonly cache: StockCache;
  readonly now: () => number;
  readonly localOnly: () => boolean;
  /** An http port is there to run the download job. */
  readonly canDownload: boolean;
  /** Stages a write on the command's unit of work (or runs it now, outside the bus). */
  readonly write: (context: CommandContext, change: StagedWrite) => Result<unknown>;
}

/** `library.importStock`: the asset it already has, or a staged download job, with the import record. */
function importHandler({ db, cache, now, localOnly, canDownload, write }: ImportDeps) {
  /** The import record's write: what undo and the job read back. */
  const record =
    (payload: ImportPayload, rest: RecordRest): StagedWrite =>
    () => {
      writeImportRecord(cache, { importId: payload.importId, ...rest }, payload.item.provider, now());
      return ok(undefined);
    };
  return async (
    payload: ImportPayload,
    context: CommandContext,
  ): AsyncResult<CommandOutcome<ImportResult>> => {
    if (localOnly()) return err(LocalOnly({ what: 'stock' }));
    const resolved = resolveCachedRendition(cache, payload.item, now());
    if (!resolved) return err(StockUnavailable({ provider: payload.item.provider }));
    const licence = classifyLicence(payload.item.provider, resolved.rawLicence);
    if (!licence.ok) return licence;
    const prior = existingStockAsset(db, payload.item.provider, payload.item.providerId);
    if (prior) {
      const kept = write(
        context,
        record(payload, { jobId: null, assetId: prior, filePath: managedFilePath(db, prior) }),
      );
      if (!kept.ok) return kept;
      return ok({
        result: { importId: payload.importId, jobId: null, assetId: prior } satisfies ImportResult,
      });
    }
    if (!canDownload) return err(StockUnavailable({ provider: payload.item.provider }));
    // The result names the job before its row exists: a live download of this item, or a new id.
    const live = createJobRepository(db).findByIdempotencyKey(stockImportKey(payload.item));
    const jobId = live?.id ?? newId<'Job'>();
    const staged = write(
      context,
      queueDownload(db, payload, resolved, jobId, record(payload, { jobId, assetId: null, filePath: null })),
    );
    if (!staged.ok) return staged;
    return ok({
      result: { importId: payload.importId, jobId, assetId: null },
      inverse: {
        name: C.discardStockImport,
        payload: { importId: payload.importId, projectId: payload.projectId },
      },
    });
  };
}

export function createStockCommands(db: LibraryDatabase, options: StockCommandPorts = {}) {
  const cache = options.cache ?? createSqliteStockCache(db);
  const now = () => options.clock?.() ?? db.clock();
  const localOnly = options.localOnly ?? (() => readLocalOnly(db));
  const inUse = options.inUse ?? ((assetId: AssetId) => timelineUsesAsset(db, assetId));
  const write = (context: CommandContext, change: StagedWrite): Result<unknown> =>
    options.commands ? options.commands.stage(context, change) : inTransaction(db, 'stock', change);
  const handleImport = importHandler({
    db,
    cache,
    now,
    localOnly,
    canDownload: options.http !== undefined,
    write,
  });

  const importStock = defineCommand({
    name: C.importStock,
    payload: P[C.importStock],
    sideEffect: 'write',
    handle: options.commands ? options.commands.handle(handleImport) : handleImport,
  });

  const discardStockImport = defineCommand({
    name: C.discardStockImport,
    payload: P[C.discardStockImport],
    sideEffect: 'write',
    internal: true,
    handle: async (payload): AsyncResult<CommandOutcome<DiscardResult>> => {
      const record = readImportRecord(cache, payload.importId, now());
      if (!record) return ok({ result: { removed: true } });
      if (record.jobId) {
        const cancelled = createJobRepository(db).cancel(record.jobId);
        if (
          !cancelled.ok &&
          cancelled.error.code !== 'library.invalid_state' &&
          cancelled.error.code !== 'core.not_found'
        ) {
          return cancelled;
        }
      }
      if (!record.assetId) return ok({ result: { removed: true } });
      const gone = discardImportedAsset(db, record.assetId, inUse);
      if (!gone.ok) return gone;
      if (!gone.value.removed) return ok({ result: { removed: false, reason: 'inUse' } });
      const filePath = record.filePath ?? gone.value.filePath;
      if (filePath) {
        // The rows are gone; a file that could not be deleted is reported, not left silently.
        const deleted = await removeStockFile(filePath);
        if (!deleted.ok) return deleted;
      }
      return ok({ result: { removed: true } });
    },
  });

  return { importStock, discardStockImport };
}
