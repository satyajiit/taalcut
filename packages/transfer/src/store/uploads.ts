// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { TRANSFER_LIMITS } from '../limits';
import type { TransferDeviceId, TransferSessionId, TransferUploadId } from '@taalcut/core';

/** Server-side record so lookup survives a restart. Offset is the file's size on disk. */
export interface UploadRecord {
  id: TransferUploadId;
  deviceId: TransferDeviceId;
  sessionId: TransferSessionId;
  fingerprint: string;
  name: string;
  sizeBytes: number;
  lastModified: number | null;
  mime: string | null;
  createdAt: number;
  finishedAt: number | null;
  state: string;
}

export function createUploadIndex(stateDir: string) {
  const path = join(stateDir, 'uploads.json');
  let records: UploadRecord[] = [];

  async function load(): Promise<void> {
    await mkdir(stateDir, { recursive: true });
    try {
      const parsed = JSON.parse(await readFile(path, 'utf8')) as { uploads?: UploadRecord[] };
      records = Array.isArray(parsed.uploads) ? parsed.uploads : [];
    } catch {
      records = [];
    }
  }

  function all(): readonly UploadRecord[] {
    return records;
  }

  function get(id: string): UploadRecord | undefined {
    return records.find((record) => record.id === id);
  }

  async function save(record: UploadRecord): Promise<void> {
    records = records.filter((item) => item.id !== record.id);
    records.push(record);
    await persist();
  }

  async function drop(id: string): Promise<void> {
    records = records.filter((item) => item.id !== id);
    await persist();
  }

  /** Drop finished rows older than 24 h, and delete partials older than 24 h. */
  async function sweep(stagingDir: string, now: number): Promise<void> {
    const kept: UploadRecord[] = [];
    for (const record of records) {
      const age = now - (record.finishedAt ?? record.createdAt);
      if (age <= TRANSFER_LIMITS.partialTtlMs) {
        kept.push(record);
        continue;
      }
      if (!record.finishedAt) await removePartial(stagingDir, record.id);
    }
    records = kept;
    await persist();
  }

  async function persist(): Promise<void> {
    await mkdir(stateDir, { recursive: true });
    await writeFile(path, JSON.stringify({ uploads: records }), { mode: 0o600 });
  }

  return { load, all, get, save, drop, sweep };
}

export type UploadIndex = ReturnType<typeof createUploadIndex>;

export async function fileSize(path: string): Promise<number | null> {
  try {
    const info = await stat(path);
    return info.isFile() ? info.size : null;
  } catch {
    return null;
  }
}

async function removePartial(dir: string, id: string): Promise<void> {
  await rm(join(dir, id), { force: true });
  await rm(join(dir, `${id}.json`), { force: true });
}
