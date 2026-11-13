// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** A library with an originals root and staged uploads, as the transfer server leaves them. */
import { randomBytes } from 'node:crypto';
import { realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { newId, unwrap, type StagedImport, type TransferSessionId } from '@taalcut/core';
import { createImportSink, createRepositories, type ImportSinkOptions } from '../../src/index';
import { openTestDb, tempDir } from '../helpers';
import { fakeVolumes } from '../sources/fixture';

/** 2026-10-12 14:00 local time. */
export const RECEIVED_AT = new Date(2026, 9, 12, 14, 0).getTime();

export async function importer(options: Partial<ImportSinkOptions> = {}) {
  const db = openTestDb();
  const root = join(realpathSync(tempDir()), 'Originals');
  const sink = createImportSink(db, { originalsRoot: root, volumes: fakeVolumes(), ...options });
  const { dir } = unwrap(await sink.staging());
  const sessionId = newId<'TransferSession'>() as TransferSessionId;
  /** Stages bytes the way the transfer server does: the file, its tus info and the journal. */
  const stage = (
    fileName: string,
    bytes: Uint8Array = randomBytes(5000),
    extra: Partial<StagedImport> = {},
  ) => {
    const uploadId = newId<'TransferUpload'>();
    const path = join(dir, uploadId);
    const info = join(dir, `${uploadId}.json`);
    writeFileSync(path, bytes);
    writeFileSync(info, '{}');
    const file: StagedImport = {
      sessionId,
      uploadId,
      path,
      companions: [info],
      fileName,
      sizeBytes: bytes.length,
      mimeType: 'video/quicktime',
      lastModified: RECEIVED_AT - 60_000,
      device: { id: newId<'TransferDevice'>(), label: 'iPhone', platform: 'ios' },
      reencode: { verdict: 'unlikely', reasons: ['hevc', 'camera-metadata'] },
      receivedAt: RECEIVED_AT,
      channel: 'wifi',
      ...extra,
    };
    writeFileSync(join(dir, `${uploadId}.import.json`), JSON.stringify(file));
    return { file, bytes };
  };
  const rows = (sql: string, ...params: string[]) => db.driver.prepare(sql).all(...params);
  return { db, root, dir, sink, sessionId, stage, rows, repos: createRepositories(db) };
}
