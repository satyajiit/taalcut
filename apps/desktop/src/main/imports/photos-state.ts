// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createHash } from 'node:crypto';
import {
  defineError,
  idSchema,
  newId,
  type ImportOutcome,
  type ImportSink,
  type TransferSessionId,
} from '@taalcut/core';
import type { ImportSpaceCoordinator, LibraryDatabase, VolumeProbe } from '@taalcut/library';
import { z } from 'zod';
import type { ApplePhotosPort, PhotosAsset } from '../../platform/photos';
import { photosAssetSchema } from '../../platform/photos/types';

export const PhotosPermissionDenied = defineError('desktop.photos_permission_denied');
export const PhotosSelectionChanged = defineError('desktop.photos_selection_changed', { retryable: true });

export const photosOutcomeSchema = z.object({
  assetId: idSchema<'Asset'>(),
  sourceId: idSchema<'Source'>(),
  duplicate: z.enum(['none', 'added-managed-copy', 'already-in-library']),
});
export const photosLocatorSchema = z.object({
  key: z.string().regex(/^[a-f0-9]{64}$/),
  captureId: idSchema<'CaptureGroup'>(),
  asset: photosAssetSchema,
  uploadIds: z.record(z.string(), idSchema<'TransferUpload'>()),
});
export type PhotosLocator = z.output<typeof photosLocatorSchema>;
export const photosDataSchema = z.object({
  root: z.string().min(1),
  transferSessionId: idSchema<'TransferSession'>(),
});
export type PhotosImportData = z.output<typeof photosDataSchema>;

export const photosReceiptSchema = photosLocatorSchema.extend({
  members: z.record(
    z.string(),
    z.object({
      bytesWritten: z.number().int().nonnegative(),
      result: photosOutcomeSchema.nullable(),
    }),
  ),
  complete: z.boolean(),
});
export type PhotosReceipt = z.output<typeof photosReceiptSchema>;

export interface PhotosImportDeps {
  readonly db: LibraryDatabase;
  readonly photos: ApplePhotosPort;
  readonly originalsRoot: () => Promise<string>;
  readonly sink: (root: string) => ImportSink;
  readonly space: ImportSpaceCoordinator;
  readonly volumes: VolumeProbe;
  readonly localOnly: () => boolean;
  /** Resolves to a confined app protocol URL; never exposes native ids or paths in navigation. */
  readonly thumbnail?: (asset: PhotosAsset, opaqueId: string) => Promise<string | null>;
}

export function photosAssetKey(asset: PhotosAsset): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        asset.id,
        asset.resources.map((resource) => [
          resource.index,
          resource.type,
          resource.originalFilename,
          resource.uti,
        ]),
      ]),
    )
    .digest('hex');
}

export function readPhotosReceipt(db: LibraryDatabase, key: string): PhotosReceipt | null {
  const row = db.driver.prepare('SELECT manifest FROM photos_imports WHERE asset_key = ?').get(key);
  if (!row) return null;
  const parsed = photosReceiptSchema.safeParse(JSON.parse(String(row['manifest'])));
  return parsed.success ? parsed.data : null;
}

export function savePhotosReceipt(db: LibraryDatabase, receipt: PhotosReceipt): void {
  db.driver
    .prepare(
      `INSERT INTO photos_imports (asset_key, manifest, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(asset_key) DO UPDATE SET manifest = excluded.manifest, updated_at = excluded.updated_at`,
    )
    .run(receipt.key, JSON.stringify(receipt), db.clock());
}

export function photosLocator(asset: PhotosAsset, existing: PhotosReceipt | null): PhotosLocator {
  return {
    key: photosAssetKey(asset),
    captureId: existing?.captureId ?? newId<'CaptureGroup'>(),
    asset,
    uploadIds:
      existing?.uploadIds ??
      Object.fromEntries(asset.resources.map((resource) => [resource.index, newId<'TransferUpload'>()])),
  };
}

export async function photosReceiptKnown(sink: ImportSink, receipt: PhotosReceipt | null): Promise<boolean> {
  if (!receipt?.complete || !sink.knownAssets) return false;
  const results = Object.values(receipt.members)
    .map((member) => member.result)
    .filter((value): value is ImportOutcome => value !== null);
  if (results.length !== receipt.asset.resources.length) return false;
  const known = await sink.knownAssets(results.map((result) => result.assetId));
  return known.ok && results.every((result) => known.value.has(result.assetId));
}

export const photosImportData = (root: string): PhotosImportData => ({
  root,
  transferSessionId: newId<'TransferSession'>() as TransferSessionId,
});
