// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P3-V18 for gap handling (P3-B8): stock search (library.stockSearch) and library.importStock, as the library's
 * stock service answers them (no key, Local only and a switched-off stock refuse with core's errors).
 * fake-phase2.ts spreads `router` into `library`.
 *
 * Like packages/library: Local only refuses the search and the import (`core.local_only`); no Pexels key is not an
 * error but a page with `providersOff: ['pexels']`; an import names an item a search returned (else
 * `library.stock_unavailable`), starts a `library.stockImport` job and answers its id (inverse:
 * library.discardStockImport), or, when the item is in the library already, answers that asset and no job. The
 * scenario (`stock` in taalcut.fake's gaps options, or setScenario): 'ready' (a key is set), 'noKey', 'off' (no
 * stock service in this build: `library.stock_unavailable`), 'localOnly', 'failing' (every download fails,
 * retryably).
 */
import {
  appContract,
  defineCommand,
  err,
  implementContract,
  LIBRARY_COMMANDS,
  libraryCommandPayloads,
  LocalOnly,
  ok,
  toRpcError,
  type AnyCommand,
  type AssetId,
  type AssetProvenance,
  type AsyncResult,
  type CommandOutcome,
  type Id,
  type EventBus,
  type JobId,
  type StockSearchPage,
  type TaalcutError,
} from '@taalcut/core';
import type { FakeLibrary } from '../library/fake-library';
import { catalogueItem, searchCatalogue, stockAssetId, stockProvenance } from './stock/stock-data';
import { createStockJobs } from './stock/stock-jobs';

const PROCEDURES = { stockSearch: appContract.library.stockSearch };

export const STOCK_SCENARIOS = ['ready', 'noKey', 'off', 'localOnly', 'failing'] as const;
export type StockScenario = (typeof STOCK_SCENARIOS)[number];

export interface FakeStockDeps {
  readonly now: () => number;
  readonly events: EventBus;
  readonly library: FakeLibrary;
  /** The fake's Local only (privacy); the scenario 'localOnly' turns it on for stock alone. */
  readonly localOnly?: () => boolean;
  /** Records an imported video's provenance where library.credits reads it (the export fakes' state). */
  readonly provenance?: (assetId: AssetId, provenance: AssetProvenance) => void;
  /** Whether a timeline uses an asset (an imported video in a gap isn't discarded by undo). */
  readonly inUse?: (assetId: AssetId) => boolean;
  readonly scenario?: StockScenario;
  /** Milliseconds between an import job's steps. Default 350. */
  readonly tickMs?: number;
}

const libraryError = (code: string, params: Record<string, string>, retryable = false): TaalcutError => ({
  code,
  messageKey: `errors.${code}`,
  retryable,
  params,
});

interface ImportResult {
  readonly importId: Id<'StockImport'>;
  readonly jobId: JobId | null;
  readonly assetId: AssetId | null;
}

interface ImportRecord {
  readonly jobId: JobId | null;
  readonly providerId: string;
}

export function createFakeStock(deps: FakeStockDeps) {
  let scenario: StockScenario = deps.scenario ?? 'ready';
  const jobs = createStockJobs(deps.events, deps.tickMs ?? 350);
  /** Items a search returned (the real service caches them for import). */
  const searched = new Set<string>();
  /** Provider id → its library asset, once its job succeeded. */
  const imported = new Map<string, AssetId>();
  const records = new Map<string, ImportRecord>();
  const localOnly = () => scenario === 'localOnly' || (deps.localOnly?.() ?? false);
  const key = (providerId: string, renditionKey: string) => `${providerId}:${renditionKey}`;

  function search(input: Parameters<typeof searchCatalogue>[0]): StockSearchPage | TaalcutError {
    if (localOnly()) return LocalOnly({ what: 'stock' });
    if (scenario === 'off') return libraryError('library.stock_unavailable', { provider: 'pexels' });
    if (scenario === 'noKey') return { items: [], providersOff: ['pexels'] };
    const items = searchCatalogue(input, (providerId) => imported.get(providerId) ?? null);
    for (const item of items) searched.add(key(item.providerId, item.renditionKey));
    return { items, providersOff: [] };
  }

  const os = implementContract(PROCEDURES);
  const router = {
    stockSearch: os.stockSearch.handler(({ input }) => {
      const page = search(input);
      if ('code' in page) throw toRpcError(page);
      return page;
    }),
  };

  const commands: AnyCommand[] = [
    defineCommand({
      name: LIBRARY_COMMANDS.importStock,
      payload: libraryCommandPayloads[LIBRARY_COMMANDS.importStock],
      sideEffect: 'write',
      handle: async ({ importId, item, projectId }): AsyncResult<CommandOutcome<ImportResult>> => {
        if (localOnly()) return err(LocalOnly({ what: 'stock' }));
        const found = catalogueItem(item.providerId, item.renditionKey);
        if (scenario === 'off' || !found || !searched.has(key(item.providerId, item.renditionKey)))
          return err(libraryError('library.stock_unavailable', { provider: item.provider }));
        const prior = imported.get(item.providerId);
        if (prior) {
          records.set(importId, { jobId: null, providerId: item.providerId });
          return ok({ result: { importId, jobId: null, assetId: prior } });
        }
        const job = jobs.start(
          projectId,
          () => (scenario === 'failing' ? libraryError('library.stock_download_failed', {}, true) : null),
          () => {
            const assetId = stockAssetId(item.providerId);
            imported.set(item.providerId, assetId);
            deps.provenance?.(assetId, stockProvenance(found, deps.now()));
          },
        );
        records.set(importId, { jobId: job.id, providerId: item.providerId });
        return ok({
          result: { importId, jobId: job.id, assetId: null },
          inverse: { name: LIBRARY_COMMANDS.discardStockImport, payload: { importId, projectId } },
        });
      },
    }),
    defineCommand({
      name: LIBRARY_COMMANDS.discardStockImport,
      payload: libraryCommandPayloads[LIBRARY_COMMANDS.discardStockImport],
      sideEffect: 'write',
      internal: true,
      handle: async ({ importId }) => {
        const record = records.get(importId);
        if (!record) return ok({ result: { removed: true } });
        if (record.jobId) jobs.cancel(record.jobId);
        const assetId = imported.get(record.providerId);
        if (!assetId || !record.jobId) return ok({ result: { removed: true } });
        if (deps.inUse?.(assetId)) return ok({ result: { removed: false, reason: 'inUse' } });
        imported.delete(record.providerId);
        records.delete(importId);
        return ok({ result: { removed: true } });
      },
    }),
  ];

  return {
    router,
    commands,
    /** e2e and the dev build: how the stock service answers from now on. */
    setScenario(next: StockScenario) {
      scenario = next;
    },
    scenario: () => scenario,
    /** The stock videos in the library, by provider id. */
    imported: () => new Map(imported),
  };
}

export type FakeStock = ReturnType<typeof createFakeStock>;
