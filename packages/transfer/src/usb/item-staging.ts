// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** An item's files in staging: the part, the renamed original, and the import journal. */
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { stagedImportSchema, type StagedImport } from '@taalcut/core';
import { journalPath } from '../handoff/journal';
import { sanitiseFileName } from '../names';
import type { ItemDeps } from './item-types';
import { errnoOf } from './ledger';
import type { RunItem, RunRecord } from './run-store';
import { clipText } from './text';

export interface ItemFiles {
  readonly part: string;
  readonly final: string;
  readonly journal: string;
}

export function itemFiles(stagingDir: string, item: RunItem): ItemFiles {
  return {
    part: join(stagingDir, `${item.uploadId}.part`),
    final: join(stagingDir, item.uploadId),
    journal: journalPath(stagingDir, item.uploadId),
  };
}

/** Cancelled: the bytes go, and so does the journal, so the library's sweep can't import the item. */
export async function discard(files: ItemFiles): Promise<void> {
  await rm(files.part, { force: true });
  await rm(files.final, { force: true });
  await rm(files.journal, { force: true });
}

/**
 * A journal written before the last stop: the item is pulled and checked,
 * only the import is left. Missing is null; a damaged journal is null too
 * (the item is pulled again). Other read errors throw to the run.
 */
export async function readJournal(files: ItemFiles): Promise<StagedImport | null> {
  let text: string;
  try {
    text = await readFile(files.journal, 'utf8');
  } catch (cause) {
    if (errnoOf(cause) === 'ENOENT') return null;
    throw cause;
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    // A torn journal from a crash mid-write: the pull starts over.
    return null;
  }
  const parsed = stagedImportSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function stagedFor(
  run: RunRecord,
  item: RunItem,
  deps: ItemDeps,
  checked: {
    readonly path: string;
    readonly sha256: string;
    readonly sourceSha256: string | null;
    readonly reencode: StagedImport['reencode'];
  },
): StagedImport {
  return {
    sessionId: run.sessionId,
    uploadId: item.uploadId,
    path: checked.path,
    companions: [],
    fileName: sanitiseFileName(item.name),
    sizeBytes: item.sizeBytes,
    mimeType: item.type ? clipText(item.type, 100) || null : null,
    lastModified: item.modifiedAt ?? item.createdAt,
    device: { id: deps.deviceId, label: clipText(run.deviceLabel, 60) || 'Phone', platform: run.platform },
    reencode: checked.reencode,
    receivedAt: Math.max(0, deps.clock.now()),
    channel: 'usb',
    usb: {
      runId: run.id,
      bridge: deps.bridge,
      deviceKey: run.deviceKey,
      itemKey: item.key,
      createdAt: item.createdAt,
      album: item.album ? clipText(item.album, 120) || null : null,
      sha256: checked.sha256,
      sourceSha256: checked.sourceSha256,
    },
  };
}
