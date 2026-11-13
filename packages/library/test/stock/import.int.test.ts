// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Download, licence row, provenance, discard, and migration 19 (P3-V18). No live provider calls. */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  CAPTURED,
  LIBRARY_COMMANDS,
  LIBRARY_JOB_KINDS,
  newId,
  ok,
  toolModuleProblems,
  unwrap,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import {
  assetSummaries,
  createAssetRepository,
  createFetchStockHttp,
  createJobRepository,
  createSourceRepository,
  createSqliteStockCache,
  createStockCommands,
  createWasmContentHasher,
  managedFilePath,
  runStockImport,
  stockImportInputSchema,
  stockToolModule,
  type StockCache,
  type StockHttp,
} from '../../src/index';
import { openTestDb, tempDir } from '../helpers';
import { seedPexelsClip } from './fixtures';
import { withServer } from './local-server';

const NOW = Date.UTC(2026, 9, 12);
const ITEM = { provider: 'pexels' as const, providerId: '101', kind: 'video' as const, renditionKey: '15' };

/** The production port (the desktop injects the same factory), against the local server below. */
const httpOf = (): StockHttp => createFetchStockHttp();

const seed = (cache: StockCache, url: string, rawLicence?: string) =>
  seedPexelsClip(cache, NOW, url, rawLicence);

function ctx() {
  return { source: 'ui' as const, actor: 'user', commandId: newId<'Command'>(), projectId: null };
}

describe('stock import', () => {
  it('records the licence and provenance, then dedupes and discards', async () => {
    const body = new Uint8Array(2048).fill(7);
    await withServer({ '/clip.mp4': { type: 'video/mp4', body } }, async (origin, hits) => {
      const db = openTestDb();
      const root = tempDir();
      const cache = createSqliteStockCache(db);
      seed(cache, `${origin}/clip.mp4`);
      const commands = createStockCommands(db, { cache, clock: () => NOW, http: httpOf() });
      const importId = newId<'StockImport'>();
      const queued = unwrap(
        await commands.importStock.handle({ importId, item: ITEM, projectId: null }, ctx()),
      );
      expect(queued.result.assetId).toBeNull();
      expect(queued.inverse?.name).toBe(LIBRARY_COMMANDS.discardStockImport);
      const jobId = queued.result.jobId;
      if (jobId === null) throw new Error('expected a stock import job');
      const parsed = stockImportInputSchema.safeParse(unwrap(createJobRepository(db).get(jobId)).payload);
      expect(parsed.success).toBe(true);
      if (!parsed.success) return;
      expect(parsed.data.url).toBe(`${origin}/clip.mp4`);
      const imported = unwrap(
        await runStockImport(
          {
            db,
            http: httpOf(),
            hasher: createWasmContentHasher(),
            originalsRoot: () => root,
            cache,
            clock: () => NOW,
          },
          parsed.data,
          new AbortController().signal,
        ),
      );
      expect(hits).toEqual([{ url: '/clip.mp4', authorization: undefined }]);
      const row = db.driver
        .prepare(
          'SELECT source, provider_asset_id, licence, nc_excluded FROM asset_licences WHERE asset_id = ?',
        )
        .get(imported.assetId);
      expect(row).toEqual({
        source: 'pexels',
        provider_asset_id: '101',
        licence: 'Pexels-Licence',
        nc_excluded: 1,
      });
      const asset = unwrap(createAssetRepository(db).get(imported.assetId));
      expect(assetSummaries(db, [asset])[0]?.provenance).toMatchObject({
        kind: 'stock',
        provider: 'pexels',
        providerAssetId: '101',
        licence: 'Pexels-Licence',
      });
      const own = unwrap(
        createAssetRepository(db).create({ kind: 'video', sizeBytes: 4, originalFilename: 'own.mov' }),
      );
      expect(assetSummaries(db, [own])[0]?.provenance).toEqual(CAPTURED);
      const file = managedFilePath(db, imported.assetId);
      expect(file).toMatch(/\/Stock\/pexels\/101\.mp4$/);
      expect(file !== null && existsSync(file)).toBe(true);
      const again = unwrap(
        await commands.importStock.handle(
          { importId: newId<'StockImport'>(), item: ITEM, projectId: null },
          ctx(),
        ),
      );
      expect(again.result).toEqual({
        importId: again.result.importId,
        jobId: null,
        assetId: imported.assetId,
      });
      expect(again.inverse).toBeUndefined();
      expect(hits).toHaveLength(1);
      const held = createStockCommands(db, { cache, clock: () => NOW, inUse: () => true });
      expect(
        unwrap(await held.discardStockImport.handle({ importId, projectId: null }, ctx())).result,
      ).toEqual({ removed: false, reason: 'inUse' });
      expect(file !== null && existsSync(file)).toBe(true);
      const gone = unwrap(await commands.discardStockImport.handle({ importId, projectId: null }, ctx()));
      expect(gone.result).toEqual({ removed: true });
      expect(file !== null && existsSync(file)).toBe(false);
      expect(
        db.driver.prepare('SELECT asset_id FROM asset_licences WHERE asset_id = ?').get(imported.assetId),
      ).toBeUndefined();
    });
  });

  it('refuses local-only, a missing http port, a non-commercial raw licence, a huge body and html', async () => {
    const big = new Uint8Array(32).fill(1);
    await withServer(
      {
        '/clip.mp4': { type: 'video/mp4', body: new Uint8Array([1, 2, 3, 4]) },
        '/big.bin': { type: 'application/octet-stream', body: big },
        '/page.html': { type: 'text/html', body: new Uint8Array([60, 112, 62]) },
      },
      async (origin, hits) => {
        const db = openTestDb();
        const cache = createSqliteStockCache(db);
        const http = httpOf();
        const local = createStockCommands(db, { cache, clock: () => NOW, http, localOnly: () => true });
        seed(cache, `${origin}/clip.mp4`);
        const refused = await local.importStock.handle(
          { importId: newId<'StockImport'>(), item: ITEM, projectId: null },
          ctx(),
        );
        expect(refused.ok).toBe(false);
        if (refused.ok) return;
        expect(refused.error.code).toBe('core.local_only');
        const bare = createStockCommands(db, { cache, clock: () => NOW });
        const offline = await bare.importStock.handle(
          { importId: newId<'StockImport'>(), item: ITEM, projectId: null },
          ctx(),
        );
        expect(offline.ok).toBe(false);
        if (offline.ok) return;
        expect(offline.error.code).toBe('library.stock_unavailable');
        expect(createJobRepository(db).list({ kind: LIBRARY_JOB_KINDS.stockImport })).toEqual([]);
        seed(cache, `${origin}/clip.mp4`, 'Attribution NonCommercial');
        const nc = await createStockCommands(db, { cache, clock: () => NOW, http }).importStock.handle(
          { importId: newId<'StockImport'>(), item: ITEM, projectId: null },
          ctx(),
        );
        expect(nc.ok).toBe(false);
        if (nc.ok) return;
        expect(nc.error.code).toBe('library.stock_licence_refused');
        expect(hits).toEqual([]);
        const root = tempDir();
        const run = (url: string, maxBytes?: number) => {
          seed(cache, url);
          return runStockImport(
            {
              db,
              http,
              hasher: createWasmContentHasher(),
              originalsRoot: () => root,
              cache,
              clock: () => NOW,
              ...(maxBytes !== undefined ? { maxBytes } : {}),
            },
            {
              importId: newId<'StockImport'>(),
              item: ITEM,
              projectId: null,
              url,
              licence: 'Pexels-Licence',
              rawLicence: 'Pexels-Licence',
              author: 'Ada',
              authorUrl: 'https://www.pexels.com/@ada',
              sourceUrl: 'https://www.pexels.com/video/101/',
              title: 'Waves',
              attribution: '',
            },
            new AbortController().signal,
          );
        };
        const tooBig = await run(`${origin}/big.bin`, 8);
        expect(tooBig.ok).toBe(false);
        if (tooBig.ok) return;
        expect(tooBig.error.code).toBe('library.stock_too_large');
        const staging = join(root, '.stock-staging');
        expect(existsSync(staging) ? readdirSync(staging) : []).toEqual([]);
        const html = await run(`${origin}/page.html`);
        expect(html.ok).toBe(false);
        if (html.ok) return;
        expect(html.error.code).toBe('library.stock_download_failed');
        expect(hits.every((hit) => hit.authorization === undefined)).toBe(true);
      },
    );
  });

  it('keeps import cache rows and a pre-19 watched folder', () => {
    const db = openTestDb();
    const cache = createSqliteStockCache(db, 1);
    cache.put('search\u001fx', 'pexels', '[]', 0);
    cache.put('import:kept', 'pexels', '{"ok":true}', 0);
    expect(cache.get('search\u001fx', 10)).toBeNull();
    expect(cache.get('import:kept', 10)).toBe('{"ok":true}');
    expect(
      toolModuleProblems(
        stockToolModule({ search: { search: async () => ok({ items: [], providersOff: [] }) } }),
      ),
    ).toEqual([]);
  });

  it('keeps a watched folder and the captured default across migration 19', () => {
    const db = openTestDb({ targetVersion: 18 });
    const source = unwrap(
      createSourceRepository(db).add({
        kind: 'watched_folder',
        displayName: 'Camera',
        rootPath: '/Volumes/Camera',
      }),
    );
    const assetId = newId<'Asset'>();
    db.driver
      .prepare(
        `INSERT INTO assets (id, kind, size_bytes, original_filename, availability, created_at, updated_at)
         VALUES (?, 'video', 10, 'clip.mov', 'missing', 1, 1)`,
      )
      .run(assetId);
    unwrap(db.migrateTo(19));
    expect(db.driver.prepare('SELECT kind, display_name FROM sources WHERE id = ?').get(source.id)).toEqual({
      kind: 'watched_folder',
      display_name: 'Camera',
    });
    expect(db.driver.prepare('SELECT provenance FROM assets WHERE id = ?').get(assetId)).toEqual({
      provenance: '{"kind":"captured"}',
    });
    unwrap(db.migrateTo(0));
    expect(db.schemaVersion()).toBe(0);
  });
});
