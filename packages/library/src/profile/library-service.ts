// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `appContract.library` (core's libraryContract), served by the agent
 * process: browse, search and similar shots, one asset in full, its
 * transcript, sources and storage. Reads only; changes are LIBRARY_COMMANDS.
 * Search is the hybrid search (src/search), passed in so this file needs no
 * embedder.
 */
import {
  implementContract,
  libraryContract,
  ok,
  unwrapRpc,
  type AssetDetail,
  type AssetId,
  type AsyncResult,
  type ActionCount,
  type Credits,
  type LibraryFilters,
  type LibraryStorage,
  type PlaceCount,
  type SearchResult,
  type ShotId,
  type SourceView,
  type StockSearchPage,
  type Trip,
  type stockSearchInputSchema,
} from '@taalcut/core';
import type { z } from 'zod';
import type { LibraryDatabase } from '../db/database';
import { listPlaces, listTrips } from '../repositories/places';
import { createTranscriptRepository, type TranscriptPage } from '../repositories/transcripts';
import { creditsFor } from '../stock/attribution';
import { createPreviewCache } from '../stock/preview-cache';
import { defaultStockProviders } from '../stock/providers';
import { createSqliteStockCache } from '../stock/search-cache';
import { existingStockAsset } from '../stock/stock-import';
import { createStockSearch } from '../stock/stock-search';
import type { StockCredentials, StockHttp } from '../stock/stock-provider';
import { assetDetail } from './asset-detail';
import { withWaveform, type WaveformReader } from './asset-waveform';
import { browseAssets, type BrowseInput, type BrowsePage } from './browse';
import { libraryStorage, sourceViews } from './sources-view';
import { actionCounts } from '../search/actions';

/** What `library.search` and `library.findSimilar` call (createLibrarySearch implements it). */
export interface LibrarySearchPort {
  search(query: string, filters: LibraryFilters | undefined, limit: number): AsyncResult<SearchResult>;
  findSimilar(
    shotId: ShotId,
    filters: LibraryFilters | undefined,
    limit: number,
    excludeSameAsset: boolean,
  ): AsyncResult<SearchResult>;
}

export interface LibraryService {
  browse(input: BrowseInput): AsyncResult<BrowsePage>;
  search(input: { query: string; filters?: LibraryFilters; limit: number }): AsyncResult<SearchResult>;
  findSimilar(input: {
    shotId: ShotId;
    filters?: LibraryFilters;
    limit: number;
    excludeSameAsset: boolean;
  }): AsyncResult<SearchResult>;
  asset(assetId: AssetId): AsyncResult<AssetDetail>;
  transcript(input: {
    assetId: AssetId;
    fromSegment: number;
    limit: number;
  }): AsyncResult<TranscriptPage | null>;
  sources(): AsyncResult<SourceView[]>;
  storage(): AsyncResult<LibraryStorage>;
  stockSearch(input: z.input<typeof stockSearchInputSchema>): AsyncResult<StockSearchPage>;
  credits(assetIds: readonly AssetId[]): AsyncResult<Credits>;
  /** LIB1-PLACE: every trip, newest first. */
  trips(): AsyncResult<{ trips: Trip[] }>;
  /** LIB1-PLACE: the countries and cities with clips, most clips first. */
  places(): AsyncResult<{ places: PlaceCount[] }>;
  /** LIB1-FIND: the actions shots show, with how many clips show each, most first. */
  actions(): AsyncResult<{ actions: ActionCount[] }>;
}

export interface LibraryServiceDeps {
  readonly db: LibraryDatabase;
  readonly search: LibrarySearchPort;
  /** The managed originals root now (it is a setting) and, if known, its volume's name. */
  readonly originalsRoot: () => { readonly path: string; readonly volumeName?: string | null };
  /** No default: a caller that omits this cannot reach the network by accident. */
  readonly http: StockHttp;
  readonly credentials: StockCredentials;
  readonly localOnly: () => boolean;
  /** Build flag `stock.freesound`. Default off. */
  readonly freesound?: boolean;
  readonly clock?: () => number;
  /**
   * UX2: a waveform file's peaks in brief, for the clip page's sound lane (desktop reads it from the media cache).
   * Null when the file can't be read.
   */
  readonly waveform: WaveformReader;
}

export function createLibraryService(deps: LibraryServiceDeps): LibraryService {
  const { db } = deps;
  const transcripts = createTranscriptRepository(db);
  const stock = createStockSearch({
    providers: defaultStockProviders({ freesound: deps.freesound ?? false }),
    http: deps.http,
    credentials: deps.credentials,
    localOnly: deps.localOnly,
    cache: createSqliteStockCache(db),
    clock: { now: deps.clock ?? Date.now },
    alreadyImported: (provider, providerId) => existingStockAsset(db, provider, providerId),
    previews: createPreviewCache(),
  });
  return {
    browse: async (input) => browseAssets(db, input),
    search: (input) => deps.search.search(input.query, input.filters, input.limit),
    findSimilar: (input) =>
      deps.search.findSimilar(input.shotId, input.filters, input.limit, input.excludeSameAsset),
    asset: async (assetId) => withWaveform(db, assetDetail(db, assetId), deps.waveform),
    transcript: async ({ assetId, fromSegment, limit }) => ok(transcripts.page(assetId, fromSegment, limit)),
    sources: async () => ok(sourceViews(db)),
    storage: () => {
      const root = deps.originalsRoot();
      return libraryStorage(db, { originalsRoot: root.path, volumeName: root.volumeName ?? null });
    },
    stockSearch: (input) => stock.search(input),
    credits: async (assetIds) => creditsFor(db, assetIds),
    trips: async () => ok({ trips: listTrips(db) }),
    places: async () => ok({ places: listPlaces(db) }),
    actions: async () => {
      const counted = actionCounts(db);
      return counted.ok ? ok({ actions: counted.value }) : counted;
    },
  };
}

/** The agent process's `library` namespace. */
export function libraryRouter(service: LibraryService) {
  const os = implementContract(libraryContract);
  return os.router({
    browse: os.browse.handler(async ({ input }) => unwrapRpc(await service.browse(input))),
    search: os.search.handler(async ({ input }) => unwrapRpc(await service.search(input))),
    findSimilar: os.findSimilar.handler(async ({ input }) => unwrapRpc(await service.findSimilar(input))),
    asset: os.asset.handler(async ({ input }) => unwrapRpc(await service.asset(input.assetId))),
    transcript: os.transcript.handler(async ({ input }) => unwrapRpc(await service.transcript(input))),
    sources: os.sources.handler(async () => unwrapRpc(await service.sources())),
    storage: os.storage.handler(async () => unwrapRpc(await service.storage())),
    stockSearch: os.stockSearch.handler(async ({ input }) => unwrapRpc(await service.stockSearch(input))),
    credits: os.credits.handler(async ({ input }) => unwrapRpc(await service.credits(input.assetIds))),
    trips: os.trips.handler(async () => unwrapRpc(await service.trips())),
    places: os.places.handler(async () => unwrapRpc(await service.places())),
    actions: os.actions.handler(async () => unwrapRpc(await service.actions())),
  });
}
