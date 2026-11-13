// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { join } from 'node:path';
import {
  newId,
  ok,
  type AsyncResult,
  type ImportOutcome,
  type ImportSink,
  type TransferUploadId,
} from '@taalcut/core';
import type { LibraryDatabase } from '@taalcut/library';
import { discardPhotosStaging, recoverPhotosOriginal } from './photos-recovery';
import { savePhotosReceipt, type PhotosReceipt } from './photos-state';

type PhotosResume =
  | { readonly kind: 'finished'; readonly result: ImportOutcome; readonly bytesWritten: number }
  | {
      readonly kind: 'pending';
      readonly uploadId: TransferUploadId;
      readonly path: string;
      readonly dir: string;
      readonly freeBytes: number;
      readonly recoverable: boolean;
      readonly bytesWritten: number;
    };

/** Update the durable receipt before a stale resource starts a new native export. */
export async function resumePhotosResource(options: {
  readonly db: LibraryDatabase;
  readonly sink: ImportSink;
  readonly root: string;
  readonly receipt: PhotosReceipt;
  readonly key: string;
}): AsyncResult<PhotosResume> {
  const { db, sink, root, receipt, key } = options;
  let member = receipt.members[key];
  const reset = () => {
    receipt.uploadIds[key] = newId<'TransferUpload'>();
    delete receipt.members[key];
    receipt.complete = false;
    member = undefined;
    savePhotosReceipt(db, receipt);
  };
  if (member?.result && sink.knownAssets) {
    const known = await sink.knownAssets([member.result.assetId]);
    if (!known.ok) return known;
    if (known.value.has(member.result.assetId))
      return ok({
        kind: 'finished',
        result: { ...member.result, duplicate: 'already-in-library' },
        bytesWritten: member.bytesWritten,
      });
    reset();
  }
  const staging = await sink.staging();
  if (!staging.ok) return staging;
  let recoverable = false;
  if (member) {
    const path = join(staging.value.dir, receipt.uploadIds[key]!);
    const recovered = await recoverPhotosOriginal({ root, path, bytesWritten: member.bytesWritten, sink });
    if (!recovered.ok) return recovered;
    if (recovered.value.kind === 'finished') {
      receipt.members[key] = { bytesWritten: member.bytesWritten, result: recovered.value.result };
      savePhotosReceipt(db, receipt);
      return ok({ kind: 'finished', bytesWritten: member.bytesWritten, result: recovered.value.result });
    }
    recoverable = recovered.value.kind === 'staged';
    if (!recoverable) {
      await discardPhotosStaging(path);
      reset();
    }
  }
  const uploadId = receipt.uploadIds[key]!;
  return ok({
    kind: 'pending',
    uploadId,
    path: join(staging.value.dir, uploadId),
    ...staging.value,
    recoverable,
    bytesWritten: member?.bytesWritten ?? 0,
  });
}
