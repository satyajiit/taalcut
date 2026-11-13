// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Stock search, import, credits and the agent tools (P3-V18). */
export { creditsFor } from './attribution';
export { createFetchStockHttp } from './fetch-http';
export { offerStock, type StockOffer } from './gap-offer';
export { readLocalOnly } from './local-only';
export { classifyLicence, attributionLine, pexelsCourtesy, LICENCE_TABLE } from './licences';
export { createPreviewCache } from './preview-cache';
export { defaultStockProviders } from './providers';
export {
  createMemoryStockCache,
  createSqliteStockCache,
  searchCacheKey,
  STOCK_CACHE_TTL_MS,
  stockItemCacheKey,
  type StockCache,
} from './search-cache';
export { createStockCommands, type StockCommandPorts } from './stock-commands';
export {
  discardImportedAsset,
  existingStockAsset,
  managedFilePath,
  runStockImport,
  stockImportInputSchema,
  stockImportJob,
  stockImportKey,
  type StockImportDeps,
  type StockImportInput,
} from './stock-import';
export type { StockCredentials, StockHttp, StockHttpResponse, StockHttpStream } from './stock-provider';
export {
  createStockSearch,
  resolveCachedRendition,
  type ResolvedRendition,
  type StockClock,
  type StockSearch,
  type StockSearchDeps,
} from './stock-search';
export { stockToolModule, type StockToolDeps } from './stock-tools';
