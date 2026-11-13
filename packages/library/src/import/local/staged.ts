// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { link, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type AsyncResult,
  type ImportOutcome,
  type ImportSink,
  type StagedImport,
  type TransferUploadId,
} from '@taalcut/core';
import { fsyncPath, writeDurably } from '../../files/durable-files';
import type { ImportRunContext } from '../../imports/adapter';
import type { CaptureFile } from './camera-profiles';
import type { LocalImportData } from './types';
import type { ImportSpaceCoordinator } from './space';
import { copySelectedOriginal, type CopyProgress } from './verified-copy';

/** A resumed group reuses each completed sink receipt before reading its source again. */
export async function stageLocalAsset(options: {
  readonly file: CaptureFile;
  readonly uploadId: TransferUploadId;
  readonly data: LocalImportData;
  readonly context: ImportRunContext;
  readonly sink: ImportSink;
  readonly space: ImportSpaceCoordinator;
  readonly destinationVolume: string;
  readonly archivePath?: string;
  readonly progress: (event: CopyProgress) => void;
}): AsyncResult<ImportOutcome> {
  const { file, context, sink, space, data, uploadId } = options;
  const staging = await sink.staging();
  if (!staging.ok) return staging;
  const dir = staging.value.dir;
  const path = join(dir, uploadId);
  const donePath = join(dir, `${uploadId}.done.json`);
  const journalPath = join(dir, `${uploadId}.import.json`);
  const destPath = join(dir, `${uploadId}.dest`);
  const staged: StagedImport = {
    sessionId: data.transferSessionId,
    uploadId,
    path,
    companions: [],
    fileName: file.name,
    sizeBytes: file.sizeBytes,
    mimeType: null,
    lastModified: Math.round(file.modifiedAt),
    source: { label: context.draft.sourceLabel },
    channel: ['camera', 'dji', 'insta360'].includes(context.draft.method) ? 'camera' : 'local',
    reencode: { verdict: 'unknown', reasons: [] },
    receivedAt: Date.now(),
  };
  const done = await readFile(donePath, 'utf8').catch(() => null);
  if (done) {
    // A receipt is reusable only while the sink can still verify its managed original.
    const restored = await sink.importStaged(staged, { signal: context.signal });
    if (restored.ok || restored.error.code !== 'core.validation') return restored;
  }
  const journal = await readFile(journalPath, 'utf8').catch(() => null);
  if (journal) {
    const saved = JSON.parse(journal) as StagedImport;
    const destination = await readFile(destPath, 'utf8').catch(() => null);
    const present = async (candidate: string | null) => {
      const info = candidate ? await stat(candidate).catch(() => null) : null;
      return info?.isFile() && info.size === file.sizeBytes;
    };
    if ((await present(saved.path)) || (await present(destination)))
      return sink.importStaged(saved, { signal: context.signal });
  }
  // A vanished staging file and destination require a fresh copy, never an unverified success receipt.
  await Promise.all([donePath, journalPath, destPath].map((entry) => rm(entry, { force: true })));
  await rm(path, { force: true });
  if (options.archivePath) {
    // A second name on the same originals volume preserves the capture without duplicating its bytes.
    await link(options.archivePath, path);
  } else {
    const reservation = await space.reserve(
      context.session.id,
      options.destinationVolume,
      dir,
      file.sizeBytes,
    );
    if (!reservation.ok) return reservation;
    const copied = await copySelectedOriginal(file, path, {
      signal: context.signal,
      progress: options.progress,
      afterChunk: (bytes) => space.consume(context.session.id, bytes),
    });
    if (!copied.ok) return copied;
  }
  await writeDurably(join(dir, `${uploadId}.import.json`), JSON.stringify(staged));
  await fsyncPath(dir);
  return sink.importStaged(staged, { signal: context.signal });
}
