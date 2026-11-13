// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Regression tests for `library.listSources`, `library.listFiles`, and `library.getAsset`:
 * 1. `library.listSources` suppresses `sourcePicker` card when indexed assets already exist.
 * 2. `library.listFiles` returns SQLite indexed assets + `assetId`s for `usb_import` / empty `root_path` / subfolders.
 * 3. `library.getAsset` reports `contactSheetStatus: 'indexing'` while a video's contact sheet stage is in progress.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import {
  newId,
  ok,
  parseCard,
  unwrap,
  type AnyTool,
  type CommandToolContext,
  type SourceView,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createRepositories, libraryToolModule } from '../../src/index';
import { openTestDb, tempDir } from '../helpers';
import { searchFixture } from '../search/search-helpers';

const hex = (tag: string, len: number) => createHash('sha256').update(tag).digest('hex').slice(0, len);

function makeCtx(): CommandToolContext {
  return {
    signal: new AbortController().signal,
    callId: newId<'ToolRun'>(),
    runId: newId<'AgentRun'>(),
    attempt: 1,
    artifacts: {
      put: async (artifact) =>
        ok({
          id: newId<'Artifact'>(),
          mediaType: artifact.mediaType,
          bytes: 1,
          summary: artifact.summary,
        }),
      get: async () => {
        throw new Error('unused');
      },
    },
    reportUsage: () => {},
    reportProgress: () => {},
    dispatch: async () => ok(undefined),
  };
}

describe('library.listSources, library.listFiles & library.getAsset fixes', () => {
  it('suppresses sourcePicker card when indexed assets exist and shows it when library has 0 assets', async () => {
    const populated = searchFixture();
    const popMod = libraryToolModule({
      db: populated.db,
      search: populated.search,
      importStatus: async () =>
        ok({ paused: false, overall: {} as never, sources: [], etaMs: 0, updatedAt: 1 }),
    });
    const listPop = popMod.tools.find((t) => t.name === 'library.listSources')! as AnyTool;
    const ctx = makeCtx();
    const cardCtx = { runId: ctx.runId!, toolCallId: ctx.callId, projectId: null, signal: ctx.signal };
    const popOut = unwrap(await listPop.run({}, ctx)) as { sources: SourceView[] };
    expect(popOut.sources.reduce((sum, src) => sum + src.assets, 0)).toBeGreaterThan(0);
    expect(unwrap(await listPop.resultCard!(popOut, cardCtx))).toBeUndefined();

    // Empty database (0 sources, 0 assets) still shows the sourcePicker card.
    const emptyDb = openTestDb({ file: false });
    const emptyMod = libraryToolModule({
      db: emptyDb,
      search: populated.search,
      importStatus: async () =>
        ok({ paused: false, overall: {} as never, sources: [], etaMs: 0, updatedAt: 1 }),
    });
    const listEmpty = emptyMod.tools.find((t) => t.name === 'library.listSources')! as AnyTool;
    const emptyOut = unwrap(await listEmpty.run({}, ctx)) as { sources: SourceView[] };
    expect(emptyOut.sources).toEqual([]);
    const card = unwrap(await listEmpty.resultCard!(emptyOut, cardCtx));
    expect(parseCard(card).ok).toBe(true);
    expect(card).toMatchObject({ type: 'sourcePicker', status: 'pending' });
  });

  it('lists SQLite indexed assets with assetId for usb_import sources with date subfolders or empty root_path', async () => {
    const db = openTestDb({ file: false });
    const repos = createRepositories(db);
    const originals = join(realpathSync(tempDir()), 'Originals');
    mkdirSync(join(originals, '2026-11', 'ab'), { recursive: true });

    const usbSource = unwrap(
      repos.sources.add({
        kind: 'usb_import',
        displayName: 'iPhone USB',
        rootPath: originals,
        deviceLabel: 'iPhone USB',
      }),
    );

    const clipA = unwrap(
      repos.assets.create({
        kind: 'video',
        sizeBytes: 4_200_000,
        originalFilename: '20261102_100000.mp4',
        contentHash: hex('usb:a', 64),
        partialHash: hex('usb:pa', 32),
      }),
    );
    const clipB = unwrap(
      repos.assets.create({
        kind: 'image',
        sizeBytes: 900_000,
        originalFilename: 'IMG_0002.HEIC',
        contentHash: hex('usb:b', 64),
        partialHash: hex('usb:pb', 32),
      }),
    );
    unwrap(
      repos.assetLocations.add({
        assetId: clipA.id,
        sourceId: usbSource.id,
        storage: 'managed',
        relativePath: '2026-11/ab/20261102_100000.mp4',
        sizeBytes: clipA.sizeBytes,
        mtimeMs: 1_762_000_000_000,
        state: 'present',
      }),
    );
    unwrap(
      repos.assetLocations.add({
        assetId: clipB.id,
        sourceId: usbSource.id,
        storage: 'managed',
        relativePath: '2026-11/ab/IMG_0002.HEIC',
        sizeBytes: clipB.sizeBytes,
        mtimeMs: 1_762_000_005_000,
        state: 'present',
      }),
    );
    // Simulate a local_import / null-like empty root_path source row in SQLite.
    db.driver.prepare('UPDATE sources SET root_path = ? WHERE id = ?').run('', usbSource.id);

    const mod = libraryToolModule({
      db,
      search: {
        search: async () => ok({ hits: [], tookMs: 0 }),
        findSimilar: async () => ok({ hits: [], tookMs: 0 }),
      },
      importStatus: async () =>
        ok({ paused: false, overall: {} as never, sources: [], etaMs: 0, updatedAt: 1 }),
    });
    const listFiles = mod.tools.find((t) => t.name === 'library.listFiles')! as AnyTool;
    const res = unwrap(await listFiles.run(listFiles.input.parse({ sourceId: usbSource.id }), makeCtx())) as {
      files: Array<{ assetId?: string; name: string; type: string; sizeBytes: number }>;
      total: number;
    };

    expect(listFiles.output.safeParse(res).success).toBe(true);
    expect(res.total).toBe(2);
    expect(res.files).toEqual([
      expect.objectContaining({
        assetId: clipA.id,
        name: '20261102_100000.mp4',
        type: 'video',
        sizeBytes: 4_200_000,
      }),
      expect.objectContaining({
        assetId: clipB.id,
        name: 'IMG_0002.HEIC',
        type: 'image',
        sizeBytes: 900_000,
      }),
    ]);
  });

  it('reports contactSheetStatus: indexing when a video contact sheet is still queued or running', async () => {
    const s = searchFixture();
    const videoId = s.fixture.assets.find((id) => unwrap(s.repos.assets.get(id)).kind === 'video')!;
    s.db.driver
      .prepare(
        `INSERT OR REPLACE INTO asset_index_stages (asset_id, stage, state, version, updated_at)
         VALUES (?, 'vision.contactSheet', 'waiting', 1, 100)`,
      )
      .run(videoId);

    const mod = libraryToolModule({
      db: s.db,
      search: s.search,
      importStatus: async () =>
        ok({ paused: false, overall: {} as never, sources: [], etaMs: 0, updatedAt: 1 }),
    });
    const getAsset = mod.tools.find((t) => t.name === 'library.getAsset')! as AnyTool;
    const indexingOut = unwrap(
      await getAsset.run(getAsset.input.parse({ assetId: videoId, include: ['shots'] }), makeCtx()),
    ) as { contactSheet?: unknown; contactSheetStatus?: string };
    expect(getAsset.output.safeParse(indexingOut).success).toBe(true);
    expect(indexingOut.contactSheet).toBeUndefined();
    expect(indexingOut.contactSheetStatus).toBe('indexing');

    // Once all stages are done, contactSheetStatus is omitted.
    s.db.driver.prepare(`UPDATE asset_index_stages SET state = 'done' WHERE asset_id = ?`).run(videoId);
    const doneOut = unwrap(
      await getAsset.run(getAsset.input.parse({ assetId: videoId, include: ['shots'] }), makeCtx()),
    ) as { contactSheetStatus?: string };
    expect(doneOut.contactSheetStatus).toBeUndefined();
  });
});
