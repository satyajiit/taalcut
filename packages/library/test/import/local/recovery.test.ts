// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { unwrap, type ImportItemOutcome, type StagedImport } from '@taalcut/core';
import { expect, it } from 'vitest';
import {
  createDeviceVolumeProbe,
  createImportSessionService,
  createLocalImportAdapter,
  type ImportRunContext,
} from '../../../src/index';
import type { LocalImportData, LocalImportLocator } from '../../../src/import/local/run';
import { openTestDb, tempDir } from '../../helpers';

it.each(['done', 'journal'])(
  'recopies a selected original when its %s receipt outlives the saved bytes',
  async (mode) => {
    const db = openTestDb();
    const root = join(tempDir(), 'originals');
    await mkdir(root);
    const source = join(tempDir(), 'take.mp4');
    await writeFile(source, 'recoverable footage');
    const adapter = createLocalImportAdapter({
      db,
      originalsRoot: async () => root,
      volumes: createDeviceVolumeProbe(),
      pick: async () => ({ ok: true, value: [source] }),
    });
    let captured: ImportRunContext | undefined;
    const service = createImportSessionService({
      db,
      adapters: {
        files: {
          ...adapter,
          run: async (ctx) => {
            captured = ctx;
            return adapter.run(ctx);
          },
        },
      },
    });
    const { draftId } = unwrap(await service.createDraft({ method: 'files', watch: false }));
    const { sessionId } = unwrap(await service.start(draftId));
    await expect.poll(() => service.session({ sessionId })?.session.status).not.toBe('running');
    const first = db.driver
      .prepare('SELECT asset_id, absolute_path_cached AS path FROM asset_locations')
      .get()!;
    await rm(String(first.path));
    const ctx = captured!;
    const locator = ctx.items[0]!.locator as LocalImportLocator;
    const file = locator.capture.files[0]!;
    const uploadId = locator.uploadIds[file.name]!;
    const dir = join(root, '.incoming');
    if (mode === 'journal') {
      await rm(join(dir, `${uploadId}.done.json`));
      const staged: StagedImport = {
        sessionId: (ctx.privateData as LocalImportData).transferSessionId,
        uploadId,
        path: join(dir, uploadId),
        companions: [],
        fileName: file.name,
        sizeBytes: file.sizeBytes,
        mimeType: null,
        lastModified: Math.round(file.modifiedAt),
        source: { label: ctx.draft.sourceLabel },
        channel: 'local',
        reencode: { verdict: 'unknown', reasons: [] },
        receivedAt: Date.now(),
      };
      await writeFile(join(dir, `${uploadId}.import.json`), JSON.stringify(staged));
    }
    await writeFile(join(dir, `${uploadId}.dest`), '/vanished/original.mp4');
    const outcomes: ImportItemOutcome[] = [];
    unwrap(await adapter.run({ ...ctx, report: (outcome) => outcomes.push(outcome) }));
    expect(outcomes.at(-1)).toMatchObject({ state: 'imported', result: { assetId: first.asset_id } });
    const repaired = db.driver.prepare('SELECT absolute_path_cached AS path FROM asset_locations').get()!;
    expect(await readFile(String(repaired.path), 'utf8')).toBe('recoverable footage');
    expect(await readFile(source, 'utf8')).toBe('recoverable footage');
    await service.close();
  },
);
