// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { join } from 'node:path';
import type { PublicError, StagedImport } from '@taalcut/core';
import type { TransferDeps, TransferPlatform } from '../deps';
import { TRANSFER_LIMITS } from '../limits';
import { checkReencode, type ReencodeProbe } from '../reencode';
import type { LiveFile } from '../session/live';
import { journalPath, writeImportJournal } from './journal';
import { normaliseProbe } from './probe';

/** One import at a time, after the phone has its response. */
export function createHandoff(
  deps: TransferDeps,
  hooks: {
    device(file: LiveFile): { label: string; platform: TransferPlatform; userAgent: string } | null;
    update(file: LiveFile): void;
    note(line: string): void;
  },
) {
  const queue: Array<{ file: LiveFile; dir: string }> = [];
  let pumping = false;
  let scheduled = false;
  const drainers: Array<() => void> = [];

  function enqueue(file: LiveFile, dir: string): void {
    queue.push({ file, dir });
    if (scheduled) return;
    scheduled = true;
    setImmediate(() => {
      scheduled = false;
      void pump();
    });
  }

  async function pump(): Promise<void> {
    if (pumping) return;
    pumping = true;
    try {
      while (queue.length > 0) {
        const job = queue.shift();
        if (!job) continue;
        try {
          await run(job.file, job.dir);
        } catch {
          job.file.state = 'failed';
          job.file.updatedAt = deps.clock.now();
          hooks.update(job.file);
          hooks.note(`import ${job.file.id} ${job.file.ext} ${job.file.sizeBytes} failed`);
        }
      }
    } finally {
      pumping = false;
    }
    if (queue.length > 0) {
      void pump();
      return;
    }
    for (const wake of drainers.splice(0)) wake();
  }

  async function run(file: LiveFile, dir: string): Promise<void> {
    const device = hooks.device(file);
    if (!device) return;
    file.state = 'checking';
    file.updatedAt = deps.clock.now();
    hooks.update(file);
    let probe: ReencodeProbe = {};
    try {
      probe = normaliseProbe(await deps.media.probe(join(dir, file.id)));
    } catch {
      // An unreadable file still imports; the verdict stays unknown.
    }
    const reencode = checkReencode({
      userAgent: device.userAgent,
      fileName: file.name,
      lastModified: file.lastModified,
      receivedAt: file.receivedAt ?? deps.clock.now(),
      probe,
    });
    file.reencode = reencode;
    const staged = stagedFrom(file, dir, device, reencode);
    await writeImportJournal(dir, staged);
    file.state = 'importing';
    file.updatedAt = deps.clock.now();
    hooks.update(file);
    let failure: PublicError | null = null;
    for (let attempt = 1; attempt <= TRANSFER_LIMITS.importRetries; attempt += 1) {
      const result = await deps.importSink.importStaged(staged);
      if (result.ok) {
        file.state = result.value.duplicate === 'none' ? 'imported' : 'duplicate';
        file.assetId = result.value.assetId;
        file.error = undefined;
        file.updatedAt = deps.clock.now();
        hooks.update(file);
        hooks.note(`import ${file.id} ${file.ext} ${file.sizeBytes} ${file.state}`);
        return;
      }
      failure = publicError(result.error);
      if (!result.error.retryable) break;
    }
    file.state = 'failed';
    file.error =
      failure ??
      publicError({
        code: 'transfer.import_failed',
        messageKey: 'errors.transfer.import_failed',
        retryable: true,
      });
    file.updatedAt = deps.clock.now();
    hooks.update(file);
    hooks.note(`import ${file.id} ${file.ext} ${file.sizeBytes} failed`);
  }

  function drained(): Promise<void> {
    if (!pumping && !scheduled && queue.length === 0) return Promise.resolve();
    return new Promise((resolve) => drainers.push(resolve));
  }

  return { enqueue, drained };
}

function stagedFrom(
  file: LiveFile,
  dir: string,
  device: { label: string; platform: TransferPlatform },
  reencode: NonNullable<LiveFile['reencode']>,
): StagedImport {
  return {
    sessionId: file.sessionId,
    uploadId: file.id,
    path: join(dir, file.id),
    companions: [join(dir, `${file.id}.json`)],
    fileName: file.name,
    sizeBytes: file.sizeBytes,
    mimeType: file.mime,
    lastModified: file.lastModified,
    device: { id: file.deviceId, label: device.label, platform: device.platform },
    reencode,
    receivedAt: file.receivedAt ?? file.updatedAt,
    channel: 'wifi',
  };
}

function publicError(error: {
  code: string;
  messageKey: string;
  retryable: boolean;
  params?: PublicError['params'];
  fix?: PublicError['fix'];
}): PublicError {
  return {
    code: error.code,
    messageKey: error.messageKey,
    retryable: error.retryable,
    ...(error.params ? { params: error.params } : {}),
    ...(error.fix ? { fix: error.fix } : {}),
  };
}

export { journalPath };
