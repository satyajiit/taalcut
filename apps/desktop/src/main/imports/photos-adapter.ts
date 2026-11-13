// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  MEDIA_HOST,
  err,
  newId,
  ok,
  toTaalcutError,
  type AsyncResult,
  type CaptureGroup,
} from '@taalcut/core';
import {
  mediaTypeOf,
  type ImportAdapter,
  type PreparedImport,
  type PreparedImportItem,
} from '@taalcut/library';
import type { PhotosAsset } from '../../platform/photos';
import {
  photosAssetKey,
  photosDataSchema,
  photosImportData,
  photosLocator,
  photosLocatorSchema,
  photosReceiptKnown,
  readPhotosReceipt,
  PhotosPermissionDenied,
  PhotosSelectionChanged,
  type PhotosImportDeps,
} from './photos-state';
import { runPhotosImport } from './photos-run';

export async function listPhotosAssets(deps: PhotosImportDeps): AsyncResult<PhotosAsset[]> {
  const assets = new Map<string, PhotosAsset>();
  let cursor: number | null = 0;
  while (cursor !== null) {
    const page = await deps.photos.list({ cursor, limit: 500 });
    if (!page.ok) return page;
    for (const asset of page.value.items) assets.set(asset.id, asset);
    if (page.value.nextCursor !== null && page.value.nextCursor <= cursor)
      return err(PhotosSelectionChanged());
    cursor = page.value.nextCursor;
  }
  return ok([...assets.values()]);
}

const canRead = (authorization: string) => authorization === 'authorized' || authorization === 'limited';
const missingCompanions = (asset: PhotosAsset) =>
  asset.livePhoto && !asset.resources.some((resource) => resource.role === 'paired_video');

async function preparePhotos(deps: PhotosImportDeps): AsyncResult<PreparedImport> {
  const connected = await deps.photos.connect();
  if (!connected.ok) return connected;
  if (!canRead(connected.value.authorization)) return err(PhotosPermissionDenied());
  const listed = await listPhotosAssets(deps);
  if (!listed.ok) return listed;
  const root = await deps.originalsRoot();
  const sink = deps.sink(root);
  const items: PreparedImportItem[] = [];
  const captures: CaptureGroup[] = [];
  for (const asset of listed.value) {
    const id = newId<'ImportItem'>();
    const previous = readPhotosReceipt(deps.db, photosAssetKey(asset));
    const locator = photosLocator(asset, previous);
    const incomplete = missingCompanions(asset);
    const supported =
      asset.resources.length > 0 &&
      asset.resources.every((resource) => !!mediaTypeOf(resource.originalFilename));
    const name = asset.resources[0]?.originalFilename ?? 'Apple Photos';
    items.push({
      item: {
        id,
        name,
        sizeBytes: null,
        capturedAt:
          asset.photosMetadata.createdAt === null
            ? null
            : Math.max(0, Math.round(asset.photosMetadata.createdAt)),
        thumbnailUrl: deps.thumbnail
          ? await deps.thumbnail(asset, id)
          : `app://${MEDIA_HOST}/import-preview/${id}.jpg`,
        duplicate: await photosReceiptKnown(sink, previous),
        captureId: locator.captureId,
        required: true,
        supported,
        warning: incomplete
          ? 'photos-missing-companion'
          : supported
            ? 'photos-originals-only'
            : 'unsupported-format',
      },
      locator,
    });
    captures.push({
      id: locator.captureId,
      kind: asset.livePhoto ? 'live_photo' : 'generic',
      name,
      members: [{ itemId: id, role: 'original', required: true }],
      missingRequired: incomplete ? [name] : [],
      complete: !incomplete,
      warnings: ['photos-originals-only'],
    });
  }
  return ok({
    sourceLabel: 'Apple Photos',
    destinationLabel: root,
    items,
    captures,
    privateData: photosImportData(root),
    selectAll: false,
  });
}

/** Explicit createDraft means Connect. Restoration and preflight only read current permission and metadata. */
export function createPhotosImportAdapter(deps: PhotosImportDeps): ImportAdapter {
  return {
    capabilities: { pause: true, resume: true, cancel: true, retryFailed: true, byteResume: false },
    async prepare() {
      try {
        return await preparePhotos(deps);
      } catch (cause) {
        return err(toTaalcutError(cause));
      }
    },
    async preflight(draft, items, privateData) {
      const data = photosDataSchema.safeParse(privateData);
      if (!data.success) return err(PhotosSelectionChanged());
      const permission = await deps.photos.status();
      if (!permission.ok) return permission;
      const warnings = new Set(['photos-originals-only', 'photos-unknown-size']);
      if (!canRead(permission.value.authorization)) warnings.add('photos-permission');
      if (draft.allowNetwork && deps.localOnly()) warnings.add('photos-local-only');
      const listed = await listPhotosAssets(deps);
      if (!listed.ok) return listed;
      const current = new Map(listed.value.map((asset) => [asset.id, asset]));
      const missingRequired: string[] = [];
      let unsupportedItems = 0;
      let files = 0;
      let unchanged = true;
      for (const selected of items) {
        const parsed = photosLocatorSchema.safeParse(selected.locator);
        if (!parsed.success) return err(PhotosSelectionChanged());
        const saved = parsed.data;
        const fresh = current.get(saved.asset.id);
        if (!fresh || photosAssetKey(fresh) !== saved.key) unchanged = false;
        if (missingCompanions(saved.asset)) missingRequired.push(selected.item.name);
        if (!selected.item.supported) unsupportedItems += 1;
        files += saved.asset.resources.length;
      }
      if (!unchanged) warnings.add('source-changed');
      const staging = await deps.sink(data.data.root).staging();
      if (!staging.ok) return staging;
      const volume = await deps.volumes.identify(data.data.root);
      const availableBytes = Math.max(
        0,
        staging.value.freeBytes - deps.space.reserved(volume?.uuid ?? data.data.root) - 64 * 1024 * 1024,
      );
      return ok({
        canStart:
          items.length > 0 &&
          canRead(permission.value.authorization) &&
          unchanged &&
          missingRequired.length === 0 &&
          unsupportedItems === 0 &&
          availableBytes > 0 &&
          !(draft.allowNetwork && deps.localOnly()) &&
          draft.storage === 'copy',
        selectedItems: files,
        selectedCaptures: items.length,
        knownBytes: 0,
        unknownSizeItems: files,
        availableBytes,
        unsupportedItems,
        missingRequired,
        warnings: [...warnings],
      });
    },
    run: (context) => runPhotosImport(deps, context),
  };
}
