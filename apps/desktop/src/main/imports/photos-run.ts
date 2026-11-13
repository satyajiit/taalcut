// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  CancelledError,
  err,
  ok,
  publicErrorSchema,
  toTaalcutError,
  type AsyncResult,
  type ImportItemOutcome,
} from '@taalcut/core';
import {
  createImportReaderRegistry,
  ImportVolumeBusy,
  type ImportRunContext,
  type PreparedImportItem,
} from '@taalcut/library';
import { importPhotosResource } from './photos-resource';
import {
  photosDataSchema,
  photosLocatorSchema,
  readPhotosReceipt,
  savePhotosReceipt,
  PhotosSelectionChanged,
  type PhotosImportData,
  type PhotosImportDeps,
} from './photos-state';

async function importPhotosCapture(
  deps: PhotosImportDeps,
  context: ImportRunContext,
  data: PhotosImportData,
  selected: PreparedImportItem,
  volume: string,
): AsyncResult<ImportItemOutcome> {
  const parsed = photosLocatorSchema.safeParse(selected.locator);
  if (!parsed.success) return err(PhotosSelectionChanged());
  const locator = parsed.data;
  const lockKey = `photos:${locator.key}`;
  const locked = deps.db.driver
    .prepare('INSERT OR IGNORE INTO import_capture_locks (capture_key, pid) VALUES (?, ?)')
    .run(lockKey, process.pid);
  if (Number(locked.changes) === 0) return err(ImportVolumeBusy());
  try {
    const previous = readPhotosReceipt(deps.db, locator.key);
    const receipt = previous
      ? { ...previous, asset: locator.asset }
      : { ...locator, members: {}, complete: false };
    savePhotosReceipt(deps.db, receipt);
    const base = {
      itemId: selected.item.id,
      name: selected.item.name,
      receivedBytes: 0,
      result: null,
      error: null,
    };
    context.report({ ...base, state: 'receiving' });
    let receivedBytes = 0;
    let allDuplicate = true;
    let outcome: ImportItemOutcome['result'] = null;
    for (const resource of receipt.asset.resources) {
      if (context.signal.aborted) return err(CancelledError());
      context.progress({ currentFile: resource.originalFilename, totalBytes: null, etaSeconds: null });
      const imported = await importPhotosResource(
        {
          deps,
          context,
          data,
          receipt,
          volume,
          progress(bytes, checking) {
            context.report({
              ...base,
              receivedBytes: receivedBytes + bytes,
              state: checking ? 'checking' : 'receiving',
            });
          },
        },
        resource,
      );
      if (!imported.ok) return imported;
      receivedBytes += imported.value.bytesWritten;
      allDuplicate &&= imported.value.result.duplicate === 'already-in-library';
      if (outcome === null || resource.role === 'original')
        outcome = {
          kind: 'asset',
          assetId: imported.value.result.assetId,
          sourceId: imported.value.result.sourceId,
        };
    }
    receipt.complete = true;
    savePhotosReceipt(deps.db, receipt);
    return ok({ ...base, state: allDuplicate ? 'duplicate' : 'imported', receivedBytes, result: outcome });
  } finally {
    deps.db.driver
      .prepare('DELETE FROM import_capture_locks WHERE capture_key = ? AND pid = ?')
      .run(lockKey, process.pid);
  }
}

export async function runPhotosImport(deps: PhotosImportDeps, context: ImportRunContext): AsyncResult<void> {
  const parsed = photosDataSchema.safeParse(context.privateData);
  if (!parsed.success) return err(PhotosSelectionChanged());
  const data = parsed.data;
  const target = await deps.volumes.identify(data.root);
  const volume = target?.uuid ?? data.root;
  const readers = createImportReaderRegistry(deps.db);
  const lease = readers.acquire(context.session.id, volume);
  if (!lease.ok) return lease;
  try {
    for (const selected of context.items) {
      if (context.signal.aborted) return err(CancelledError());
      let receivedBytes = 0;
      const tracked = {
        ...context,
        report(outcome: ImportItemOutcome) {
          receivedBytes = outcome.receivedBytes;
          context.report(outcome);
        },
      };
      const result = await importPhotosCapture(deps, tracked, data, selected, volume);
      if (!result.ok) {
        if (context.signal.aborted) return result;
        context.report({
          itemId: selected.item.id,
          name: selected.item.name,
          state: 'failed',
          receivedBytes,
          result: null,
          error: publicErrorSchema.parse(result.error),
        });
      } else context.report(result.value);
    }
    return ok(undefined);
  } catch (cause) {
    return err(toTaalcutError(cause));
  } finally {
    deps.space.release(context.session.id);
    lease.value();
  }
}
