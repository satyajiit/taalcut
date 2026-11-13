// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The library's job handlers for the jobs process: scanning, hashing (the
 * `library.hash` stage), finding missing files, the staging sweep and the
 * daily collect. The jobs root registers what this returns beside media's.
 */
import {
  ok,
  registerJob,
  type EventBus,
  type ImportSink,
  type JobRegistration,
  type VectorIndex,
} from '@taalcut/core';
import type { LibraryDatabase } from '../db/database';
import { createWasmContentHasher, type ContentHasher } from '../hashing/content-hasher';
import { sweepStaging } from '../import/sweep';
import { createSqliteStockCache, type StockCache } from '../stock/search-cache';
import { runStockImport, stockImportJob } from '../stock/stock-import';
import type { StockHttp } from '../stock/stock-provider';
import { collect, type CollectDeps } from './collect';
import { findMissingFiles } from './find-missing';
import { hashAsset } from './hash-asset';
import { collectJob, findMissingFilesJob, hashAssetJob, scanSourceJob, sweepStagingJob } from './job-kinds';
import { scanSource } from './scanner';
import { createVolumeProbe, type PlaceholderStatus, type VolumeProbe } from './volumes';

export interface LibraryJobDeps {
  readonly db: LibraryDatabase;
  readonly hasher?: ContentHasher;
  readonly volumes?: VolumeProbe;
  /** The mac helper's iCloud status call, when it is available (P2-L6). */
  readonly placeholders?: PlaceholderStatus;
  readonly events?: Pick<EventBus, 'emit'>;
  /** For `library.sweepStaging`: the library's ImportSink in this process. */
  readonly importSink?: ImportSink;
  /** The active space's index: merged and collected assets lose their vectors with them. */
  readonly vectors?: Pick<VectorIndex, 'removeWhere'>;
  readonly collect?: Omit<CollectDeps, 'db' | 'removeVectors'>;
  readonly log?: (message: string) => void;
  /** Present only when this process can download. Tests and the desktop jobs root omit it. */
  readonly stock?: {
    readonly http: StockHttp;
    readonly originalsRoot: () => string | Promise<string>;
    readonly cache?: StockCache;
    readonly clock?: () => number;
    readonly maxBytes?: number;
    /** Read before each download: a job queued before Local only was turned on refuses. */
    readonly localOnly?: () => boolean;
  };
}

export function createLibraryJobs(deps: LibraryJobDeps): JobRegistration[] {
  const hasher = deps.hasher ?? createWasmContentHasher();
  const volumes = deps.volumes ?? createVolumeProbe();
  const optional = {
    ...(deps.events ? { events: deps.events } : {}),
    ...(deps.placeholders ? { placeholders: deps.placeholders } : {}),
  };
  const { vectors } = deps;
  const registered: JobRegistration[] = [
    registerJob(scanSourceJob, (input, context) =>
      scanSource({ db: deps.db, hasher, volumes, ...optional }, input, context.signal),
    ),
    registerJob(hashAssetJob, (input, context) =>
      hashAsset(
        {
          db: deps.db,
          hasher,
          ...(deps.events ? { events: deps.events } : {}),
          ...(vectors ? { vectors } : {}),
        },
        input,
        context.signal,
      ),
    ),
    registerJob(findMissingFilesJob, (input, context) =>
      findMissingFiles({ db: deps.db, hasher }, input, context.signal),
    ),
    registerJob(sweepStagingJob, async (_input, context) => {
      if (!deps.importSink) return ok({ imported: 0, removed: 0 });
      return sweepStaging(deps.importSink, {
        now: deps.db.clock,
        signal: context.signal,
        ...(deps.log ? { log: deps.log } : {}),
      });
    }),
    registerJob(collectJob, () =>
      collect({
        db: deps.db,
        ...deps.collect,
        ...(vectors ? { removeVectors: (assetIds) => vectors.removeWhere({ assetId: assetIds }) } : {}),
      }),
    ),
  ];
  const stock = stockImportRegistration(deps, hasher);
  return stock ? [...registered, stock] : registered;
}

/** Registered only when this process can download. The command refuses otherwise. */
function stockImportRegistration(deps: LibraryJobDeps, hasher: ContentHasher): JobRegistration | undefined {
  const stock = deps.stock;
  if (!stock) return undefined;
  return registerJob(stockImportJob, (input, context) =>
    runStockImport(
      {
        db: deps.db,
        http: stock.http,
        hasher,
        originalsRoot: stock.originalsRoot,
        cache: stock.cache ?? createSqliteStockCache(deps.db),
        ...(stock.clock ? { clock: stock.clock } : {}),
        ...(stock.maxBytes !== undefined ? { maxBytes: stock.maxBytes } : {}),
        ...(deps.log ? { log: deps.log } : {}),
        ...(stock.localOnly ? { localOnly: stock.localOnly } : {}),
      },
      input,
      context.signal,
    ),
  );
}
