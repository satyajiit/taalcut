// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Review fixes (P3-V18): a download streams to disk under the cap, a queued
 * import refuses under Local only, two runs of the same item keep the winner's
 * file, and a failed request names only the host. No provider is called.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { err, newId, ok, unwrap, type AsyncResult } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import {
  createFetchStockHttp,
  createSqliteStockCache,
  createWasmContentHasher,
  managedFilePath,
  runStockImport,
  StockUnavailable,
  type StockHttp,
  type StockHttpStream,
} from '../../src/index';
import { downloadStock, removeStockFile } from '../../src/stock/stock-download';
import { openTestDb, tempDir } from '../helpers';
import { withServer } from './local-server';

const NOW = Date.UTC(2026, 9, 12);
const ITEM = { provider: 'pexels' as const, providerId: '101', kind: 'video' as const, renditionKey: '15' };

interface Probe {
  pulled: number;
  stopped: boolean;
}

/** A body of `chunks` 8-byte pieces that records how far it was read and whether the reader let go early. */
function streamed(chunks: number, probe: Probe, failAt?: number): AsyncIterable<Uint8Array> {
  return {
    async *[Symbol.asyncIterator]() {
      let finished = false;
      try {
        for (let i = 0; i < chunks; i += 1) {
          if (i === failAt) throw new Error('connection reset');
          probe.pulled += 1;
          yield new Uint8Array(8).fill(i);
        }
        finished = true;
      } finally {
        probe.stopped = !finished;
      }
    },
  };
}

function httpWith(stream: StockHttpStream): StockHttp {
  return {
    get: async () => err(StockUnavailable({ provider: 'test' })),
    stream: async (): AsyncResult<StockHttpStream> => ok(stream),
  };
}

function importInput(url: string) {
  return {
    importId: newId<'StockImport'>(),
    item: ITEM,
    projectId: null,
    url,
    licence: 'Pexels-Licence' as const,
    rawLicence: 'Pexels-Licence',
    author: 'Ada',
    authorUrl: 'https://www.pexels.com/@ada',
    sourceUrl: 'https://www.pexels.com/video/101/',
    title: 'Waves',
    attribution: '',
  };
}

describe('stock download', () => {
  it('refuses a declared size over the cap before reading the body', async () => {
    const probe: Probe = { pulled: 0, stopped: false };
    const dest = join(tempDir(), 'part');
    const headers = { 'content-type': 'video/mp4', 'content-length': '4096' };
    const http = httpWith({ status: 200, headers, body: streamed(512, probe) });
    const result = await downloadStock(
      http,
      'https://cdn.test/a.mp4',
      dest,
      new AbortController().signal,
      64,
    );
    expect(!result.ok && result.error.code).toBe('library.stock_too_large');
    expect(probe.pulled).toBe(0);
    expect(existsSync(dest)).toBe(false);
  });

  it('stops reading a chunked body at the cap, and maps a dropped connection and an abort', async () => {
    const signal = new AbortController().signal;
    const big: Probe = { pulled: 0, stopped: false };
    const headers = { 'content-type': 'video/mp4' };
    const tooBig = await downloadStock(
      httpWith({ status: 200, headers, body: streamed(512, big) }),
      'https://cdn.test/a.mp4',
      join(tempDir(), 'part'),
      signal,
      64,
    );
    expect(!tooBig.ok && tooBig.error.code).toBe('library.stock_too_large');
    expect([big.pulled, big.stopped]).toEqual([9, true]);

    const reset: Probe = { pulled: 0, stopped: false };
    const dropped = await downloadStock(
      httpWith({ status: 200, headers, body: streamed(8, reset, 3) }),
      'https://cdn.test/a.mp4',
      join(tempDir(), 'part'),
      signal,
      1024,
    );
    expect(!dropped.ok && dropped.error.code).toBe('library.stock_download_failed');

    const controller = new AbortController();
    const body: AsyncIterable<Uint8Array> = {
      async *[Symbol.asyncIterator]() {
        yield new Uint8Array(8);
        controller.abort();
        yield new Uint8Array(8);
      },
    };
    const cancelled = await downloadStock(
      httpWith({ status: 200, headers, body }),
      'https://cdn.test/a.mp4',
      join(tempDir(), 'part'),
      controller.signal,
      1024,
    );
    expect(!cancelled.ok && cancelled.error.code).toBe('core.cancelled');
  });

  it('streams a chunked response from the fetch port and stops it at the cap', async () => {
    const body = new Uint8Array(4096).fill(3);
    await withServer({ '/clip.mp4': { type: 'video/mp4', body, chunked: true } }, async (origin) => {
      const db = openTestDb();
      const root = tempDir();
      const deps = {
        db,
        http: createFetchStockHttp(),
        hasher: createWasmContentHasher(),
        originalsRoot: () => root,
        cache: createSqliteStockCache(db),
        clock: () => NOW,
      };
      const signal = new AbortController().signal;
      const capped = await runStockImport(
        { ...deps, maxBytes: 100 },
        importInput(`${origin}/clip.mp4`),
        signal,
      );
      expect(!capped.ok && capped.error.code).toBe('library.stock_too_large');
      expect(readdirSync(join(root, '.stock-staging'))).toEqual([]);
      const whole = unwrap(await runStockImport(deps, importInput(`${origin}/clip.mp4`), signal));
      expect(managedFilePath(db, whole.assetId)).toMatch(/\/Stock\/pexels\/101\.mp4$/);
    });
  });

  it('refuses a queued import once Local only is on, before any request', async () => {
    await withServer(
      { '/clip.mp4': { type: 'video/mp4', body: new Uint8Array(16) } },
      async (origin, hits) => {
        const db = openTestDb();
        const refused = await runStockImport(
          {
            db,
            http: createFetchStockHttp(),
            hasher: createWasmContentHasher(),
            originalsRoot: () => tempDir(),
            cache: createSqliteStockCache(db),
            clock: () => NOW,
            localOnly: () => true,
          },
          importInput(`${origin}/clip.mp4`),
          new AbortController().signal,
        );
        expect(!refused.ok && refused.error.code).toBe('core.local_only');
        expect(hits).toEqual([]);
      },
    );
  });

  it('keeps the first import’s file when a second run of the same item loses the race', async () => {
    const body = new Uint8Array(2048).fill(9);
    await withServer({ '/clip.mp4': { type: 'video/mp4', body } }, async (origin) => {
      const db = openTestDb();
      const root = tempDir();
      const deps = {
        db,
        http: createFetchStockHttp(),
        hasher: createWasmContentHasher(),
        originalsRoot: () => root,
        cache: createSqliteStockCache(db),
        clock: () => NOW,
      };
      const signal = new AbortController().signal;
      const [first, second] = await Promise.all([
        runStockImport(deps, importInput(`${origin}/clip.mp4`), signal),
        runStockImport(deps, importInput(`${origin}/clip.mp4`), signal),
      ]);
      const winner = unwrap(first).assetId;
      expect(unwrap(second).assetId).toBe(winner);
      const file = managedFilePath(db, winner);
      expect(file !== null && existsSync(file)).toBe(true);
    });
  });

  it('names only the host when a request fails, and treats a missing file as removed', async () => {
    const http = createFetchStockHttp();
    const failed = await http.get(
      'http://127.0.0.1:9/v1/videos/search?query=private%20words',
      { Authorization: 'secret-key' },
      new AbortController().signal,
    );
    expect(failed.ok).toBe(false);
    if (failed.ok) return;
    expect(failed.error.code).toBe('library.stock_unavailable');
    expect(failed.error.params).toEqual({ provider: '127.0.0.1' });
    expect(JSON.stringify(failed.error)).not.toMatch(/private|secret-key/);
    expect((await removeStockFile(join(tempDir(), 'never-written'))).ok).toBe(true);
  });
});
