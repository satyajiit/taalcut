// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `library.stockImport`: download one rendition and record the asset, a Stock
 * source, the licence and provenance. It does not run shot-index, analysis or
 * embeddings. The URL arrives on the job input (the command read it from the
 * search cache). The API key is not read and not sent: Pexels file links are
 * plain HTTPS.
 */
import { join } from 'node:path';
import {
  CancelledError,
  defineJobKind,
  err,
  idSchema,
  LIBRARY_JOB_KINDS,
  LocalOnly,
  ok,
  parseId,
  stockItemRefSchema,
  stockProvenanceSchema,
  STOCK_LICENCES,
  type AssetId,
  type AsyncResult,
  type Result,
  type StockImportId,
  type TaalcutError,
} from '@taalcut/core';
import { z } from 'zod';
import type { LibraryDatabase } from '../db/database';
import type { ContentHasher } from '../hashing/content-hasher';
import { removeAssets } from '../repositories/asset-removal';
import { createAssetLocationRepository, normaliseRelativePath } from '../repositories/asset-locations';
import { createAssetRepository } from '../repositories/media-library';
import { attemptWrite, inTransaction } from '../repositories/shared';
import { managedSource } from '../repositories/sources';
import { assetLicences } from '../schema/library';
import { sha256Hex } from '../stores/canonical';
import { StockDownloadFailed, StockUnavailable } from '../errors';
import { classifyLicence } from './licences';
import type { StockCache } from './search-cache';
import { cleanUpStockFile, downloadStock, extensionFor, placeStockFile, safeStockId } from './stock-download';
import { parseJsonText } from '../db/json-text';
import type { StockHttp } from './stock-provider';

const MAX_DOWNLOAD_BYTES = 500 * 1024 * 1024;

export const stockImportInputSchema = z.object({
  importId: idSchema<'StockImport'>(),
  item: stockItemRefSchema,
  projectId: idSchema<'Project'>().nullable(),
  url: z.url(),
  licence: z.enum(STOCK_LICENCES),
  rawLicence: z.string().max(200),
  author: z.string().max(200).nullable(),
  authorUrl: z.url().nullable(),
  sourceUrl: z.url().nullable(),
  title: z.string().max(300),
  attribution: z.string().max(500),
});
export type StockImportInput = z.output<typeof stockImportInputSchema>;

export const importRecordSchema = z.object({
  importId: idSchema<'StockImport'>(),
  jobId: idSchema<'Job'>().nullable(),
  assetId: idSchema<'Asset'>().nullable(),
  filePath: z.string().nullable(),
});
export type ImportRecord = z.output<typeof importRecordSchema>;

export const stockImportJob = defineJobKind({
  kind: LIBRARY_JOB_KINDS.stockImport,
  input: stockImportInputSchema,
  output: z.object({ assetId: idSchema<'Asset'>() }),
  resource: 'network',
  priority: 'normal',
  timeoutMs: 600_000,
  retry: {
    maxAttempts: 2,
    backoff: { kind: 'exponential', initialMs: 1000, maxMs: 60_000, factor: 2, jitter: true },
  },
  resumable: true,
  idempotencyKey: (input) => stockImportKey(input.item),
});

/** sha256 of provider, provider id and rendition. The same key the import tool declares. */
export function stockImportKey(item: {
  readonly provider: string;
  readonly providerId: string;
  readonly renditionKey: string;
}): string {
  return sha256Hex(`${item.provider}\u001f${item.providerId}\u001f${item.renditionKey}`);
}

export interface StockImportDeps {
  readonly db: LibraryDatabase;
  readonly http: StockHttp;
  readonly hasher: ContentHasher;
  readonly originalsRoot: () => string | Promise<string>;
  readonly cache: StockCache;
  readonly clock?: () => number;
  /** Default 500 MB. Tests inject a few bytes. */
  readonly maxBytes?: number;
  /** Where a failed cleanup of a partial file is reported. */
  readonly log?: (message: string) => void;
  /**
   * `privacy.localOnly` now. A job queued before the user turned it on must
   * still not reach the network, so it is read again before the download.
   */
  readonly localOnly?: () => boolean;
}

export function existingStockAsset(
  db: LibraryDatabase,
  provider: string,
  providerId: string,
): AssetId | null {
  const row = db.driver
    .prepare('SELECT asset_id FROM asset_licences WHERE source = ? AND provider_asset_id = ?')
    .get(provider, providerId);
  if (!row || typeof row.asset_id !== 'string') return null;
  const id = parseId<'Asset'>(row.asset_id);
  return id.ok ? id.value : null;
}

export function managedFilePath(db: LibraryDatabase, assetId: AssetId): string | null {
  const row = db.driver
    .prepare(
      `SELECT s.root_path AS root, l.relative_path AS rel FROM asset_locations l
       JOIN sources s ON s.id = l.source_id WHERE l.asset_id = ? AND l.storage = 'managed' LIMIT 1`,
    )
    .get(assetId);
  if (!row || typeof row.root !== 'string' || typeof row.rel !== 'string') return null;
  return join(row.root, row.rel);
}

export function readImportRecord(
  cache: StockCache,
  importId: StockImportId,
  now: number,
): ImportRecord | null {
  const body = cache.get(`import:${importId}`, now);
  if (!body) return null;
  return parseJsonText(importRecordSchema, body);
}

export function writeImportRecord(
  cache: StockCache,
  record: ImportRecord,
  provider: string,
  now: number,
): void {
  cache.put(`import:${record.importId}`, provider, JSON.stringify(record), now);
}

/** Deletes the asset (the licence cascades) when nothing on a timeline references it. */
export function discardImportedAsset(
  db: LibraryDatabase,
  assetId: AssetId,
  inUse: (id: AssetId) => boolean,
): Result<{ removed: boolean; reason?: 'inUse'; filePath: string | null }> {
  const filePath = managedFilePath(db, assetId);
  if (inUse(assetId)) return ok({ removed: false, reason: 'inUse', filePath });
  const removed = removeAssets(db, [assetId]);
  if (!removed.ok) return removed;
  return ok({ removed: true, filePath });
}

export function timelineUsesAsset(db: LibraryDatabase, assetId: AssetId): boolean {
  return (
    db.driver.prepare('SELECT 1 AS hit FROM timeline_asset_refs WHERE asset_id = ? LIMIT 1').get(assetId) !==
    undefined
  );
}

export async function runStockImport(
  deps: StockImportDeps,
  input: StockImportInput,
  signal: AbortSignal,
): AsyncResult<{ assetId: AssetId }> {
  if (signal.aborted) return err(CancelledError());
  if (deps.localOnly?.()) return err(LocalOnly({ what: 'stock' }));
  const licence = classifyLicence(input.item.provider, input.rawLicence);
  if (!licence.ok) return licence;
  const now = (deps.clock ?? deps.db.clock)();
  const prior = existingStockAsset(deps.db, input.item.provider, input.item.providerId);
  if (prior) {
    finishRecord(deps, input, prior, managedFilePath(deps.db, prior), now);
    return ok({ assetId: prior });
  }
  const root = await deps.originalsRoot();
  if (!root.startsWith('/')) return err(StockDownloadFailed());
  const staged = join(root, '.stock-staging', `${input.importId}.part`);
  const downloaded = await downloadStock(
    deps.http,
    input.url,
    staged,
    signal,
    deps.maxBytes ?? MAX_DOWNLOAD_BYTES,
  );
  if (!downloaded.ok) {
    await cleanUpStockFile(staged, deps.log);
    return downloaded;
  }
  if (signal.aborted) {
    await cleanUpStockFile(staged, deps.log);
    return err(CancelledError());
  }
  const digest = await deps.hasher.full(staged, { signal });
  if (!digest.ok) {
    await cleanUpStockFile(staged, deps.log);
    return digest;
  }
  const ext = extensionFor(downloaded.value.contentType, input.url);
  const idPart = safeStockId(input.item.providerId);
  const relative = normaliseRelativePath(`Stock/${input.item.provider}/${idPart}.${ext}`);
  if (!relative.ok) {
    await cleanUpStockFile(staged, deps.log);
    return err(StockDownloadFailed());
  }
  const absolute = join(root, relative.value);
  try {
    await placeStockFile(staged, absolute);
  } catch {
    // The move failed (permissions, a full disk): nothing was recorded yet.
    await cleanUpStockFile(staged, deps.log);
    await cleanUpStockFile(absolute, deps.log);
    return err(StockDownloadFailed());
  }
  const placed = { root, relative: relative.value, absolute, contentHash: digest.value };
  const saved = persist(deps.db, input, { ...placed, sizeBytes: downloaded.value.bytes }, now);
  if (!saved.ok) {
    const winner = existingStockAsset(deps.db, input.item.provider, input.item.providerId);
    await dropPlaced(deps, absolute, winner);
    if (!winner || !isLicenceDuplicate(saved.error)) return saved;
    finishRecord(deps, input, winner, managedFilePath(deps.db, winner), now);
    return ok({ assetId: winner });
  }
  if (saved.value.duplicate) await dropPlaced(deps, absolute, saved.value.assetId);
  const filePath = saved.value.duplicate ? managedFilePath(deps.db, saved.value.assetId) : absolute;
  finishRecord(deps, input, saved.value.assetId, filePath, now);
  return ok({ assetId: saved.value.assetId });
}

/**
 * Removes the file this run placed, unless an earlier import of the same item
 * owns that path: both name it `Stock/<provider>/<id>.<ext>`, so deleting it
 * would take the winner's file.
 */
async function dropPlaced(deps: StockImportDeps, absolute: string, owner: AssetId | null): Promise<void> {
  if (owner && managedFilePath(deps.db, owner) === absolute) return;
  await cleanUpStockFile(absolute, deps.log);
}

function finishRecord(
  deps: StockImportDeps,
  input: StockImportInput,
  assetId: AssetId,
  filePath: string | null,
  now: number,
): void {
  const previous = readImportRecord(deps.cache, input.importId, now);
  writeImportRecord(
    deps.cache,
    { importId: input.importId, jobId: previous?.jobId ?? null, assetId, filePath },
    input.item.provider,
    now,
  );
}

interface PlacedFile {
  readonly root: string;
  readonly relative: string;
  readonly absolute: string;
  readonly contentHash: string;
  readonly sizeBytes: number;
}

function persist(
  db: LibraryDatabase,
  input: StockImportInput,
  file: PlacedFile,
  now: number,
): Result<{ assetId: AssetId; duplicate: boolean }> {
  const { root, relative, absolute, contentHash, sizeBytes } = file;
  const licence = classifyLicence(input.item.provider, input.rawLicence);
  if (!licence.ok) return licence;
  const provenance = stockProvenanceSchema.safeParse({
    kind: 'stock',
    provider: input.item.provider,
    providerAssetId: input.item.providerId,
    licence: licence.value,
    rawLicence: input.rawLicence,
    author: input.author,
    authorUrl: input.authorUrl,
    sourceUrl: input.sourceUrl,
    attribution: input.attribution,
    fetchedAt: now,
  });
  if (!provenance.success) return err(StockUnavailable({ provider: input.item.provider }));
  const filename =
    `${input.item.provider}-${safeStockId(input.item.providerId)}.${relative.split('.').pop() ?? 'bin'}`.slice(
      0,
      200,
    );
  return inTransaction(db, 'asset', (): Result<{ assetId: AssetId; duplicate: boolean }> => {
    const prior = existingStockAsset(db, input.item.provider, input.item.providerId);
    if (prior) return ok({ assetId: prior, duplicate: true });
    const source = managedSource(db, 'stock_import', 'Stock', root);
    if (!source.ok) return source;
    const created = createAssetRepository(db).create({
      kind: input.item.kind === 'video' ? 'video' : 'audio',
      sizeBytes,
      originalFilename: filename,
      contentHash,
    });
    if (!created.ok) return created;
    db.driver
      .prepare('UPDATE assets SET provenance = ? WHERE id = ?')
      .run(JSON.stringify(provenance.data), created.value.id);
    const location = createAssetLocationRepository(db).add({
      assetId: created.value.id,
      sourceId: source.value,
      storage: 'managed',
      relativePath: relative,
      absolutePathCached: absolute,
      sizeBytes,
      state: 'present',
    });
    if (!location.ok) return location;
    const row = attemptWrite(db, 'asset_licence', () => {
      db.orm
        .insert(assetLicences)
        .values({
          assetId: created.value.id,
          source: input.item.provider,
          providerAssetId: input.item.providerId,
          licence: licence.value,
          rawLicence: input.rawLicence,
          ncExcluded: 1,
          author: input.author,
          authorUrl: input.authorUrl,
          sourceUrl: input.sourceUrl,
          attribution: input.attribution,
          fetchedAt: now,
        })
        .run();
    });
    if (!row.ok) return row;
    return ok({ assetId: created.value.id, duplicate: false });
  });
}

function isLicenceDuplicate(error: TaalcutError): boolean {
  const entity = error.params?.entity;
  return (
    entity === 'asset_licence' &&
    (error.code === 'library.conflict' || error.code === 'library.constraint_violation')
  );
}
