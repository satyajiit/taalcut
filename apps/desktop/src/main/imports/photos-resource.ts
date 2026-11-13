// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  CancelledError,
  err,
  ok,
  toTaalcutError,
  type AsyncResult,
  type ImportOutcome,
  type StagedImport,
} from '@taalcut/core';
import { fsyncPath, ImportSpaceUnavailable, writeDurably, type ImportRunContext } from '@taalcut/library';
import type { PhotosResource } from '../../platform/photos';
import { resumePhotosResource } from './photos-resume';
import {
  savePhotosReceipt,
  type PhotosImportData,
  type PhotosImportDeps,
  type PhotosReceipt,
} from './photos-state';

export interface PhotosResourceContext {
  readonly deps: PhotosImportDeps;
  readonly context: ImportRunContext;
  readonly data: PhotosImportData;
  readonly receipt: PhotosReceipt;
  readonly volume: string;
  readonly progress: (bytes: number, checking: boolean) => void;
}

/** The resource checkpoint precedes the import sink's durable journal, so a crash can finish the same upload. */
export async function importPhotosResource(
  run: PhotosResourceContext,
  resource: PhotosResource,
): AsyncResult<{ result: ImportOutcome; bytesWritten: number }> {
  const { deps, context, data, receipt } = run;
  const sink = deps.sink(data.root);
  const key = String(resource.index);
  const resumed = await resumePhotosResource({ db: deps.db, sink, root: data.root, receipt, key });
  if (!resumed.ok) return resumed;
  if (resumed.value.kind === 'finished') return ok(resumed.value);
  const { uploadId, path, dir, freeBytes, recoverable } = resumed.value;
  let bytesWritten = resumed.value.bytesWritten;
  if (!recoverable) {
    await rm(path, { force: true });
    const byteLimit = Math.max(0, freeBytes - deps.space.reserved(run.volume) - 64 * 1024 * 1024);
    if (byteLimit <= 0) return err(ImportSpaceUnavailable());
    const reserved = await deps.space.reserve(context.session.id, run.volume, dir, byteLimit);
    if (!reserved.ok) return reserved;
    let observed = 0;
    try {
      const exported = await deps.photos.exportOriginal({
        assetId: receipt.asset.id,
        resource,
        dest: path,
        signal: context.signal,
        allowNetwork: context.draft.allowNetwork,
        byteLimit,
        onBytes(bytes) {
          deps.space.consume(context.session.id, bytes - observed);
          observed = bytes;
          run.progress(bytes, false);
        },
      });
      if (!exported.ok) return exported;
      bytesWritten = exported.value.bytesWritten;
      if (bytesWritten > observed) deps.space.consume(context.session.id, bytesWritten - observed);
      receipt.members[key] = { bytesWritten, result: null };
      savePhotosReceipt(deps.db, receipt);
    } finally {
      deps.space.release(context.session.id);
    }
  }
  if (context.signal.aborted) return err(CancelledError());
  run.progress(bytesWritten, true);
  const staged: StagedImport = {
    sessionId: data.transferSessionId,
    uploadId,
    path,
    companions: [],
    fileName: resource.originalFilename,
    sizeBytes: bytesWritten,
    mimeType: null,
    lastModified:
      receipt.asset.photosMetadata.createdAt === null
        ? null
        : Math.max(0, Math.round(receipt.asset.photosMetadata.createdAt)),
    source: { label: 'Apple Photos', externalId: receipt.asset.id },
    reencode: { verdict: 'unknown', reasons: [] },
    receivedAt: deps.db.clock(),
    channel: 'photos',
  };
  try {
    // Existing journals retain their received time and source facts across a retry.
    const journal = join(dir, `${uploadId}.import.json`);
    if ((await readFile(journal, 'utf8').catch(() => null)) === null) {
      await writeDurably(journal, JSON.stringify(staged));
      await fsyncPath(dir);
    }
    const imported = await sink.importStaged(staged, { signal: context.signal });
    if (!imported.ok) return imported;
    receipt.members[key] = { bytesWritten, result: imported.value };
    savePhotosReceipt(deps.db, receipt);
    return ok({ result: imported.value, bytesWritten });
  } catch (cause) {
    return err(toTaalcutError(cause));
  }
}
