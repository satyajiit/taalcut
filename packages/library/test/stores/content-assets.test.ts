// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The content-addressed asset store both template sheets and Style logos stand on, over a kind of its own: a put
 * checks what its kind accepts and writes the file before the row, a path needs both, and `prune` deletes the
 * rows its kind calls unused, then files with no row once they are past the grace a put in flight gets.
 */
import { existsSync, mkdirSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { unwrap } from '@taalcut/core';
import { lt } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { templateAssets } from '../../src/schema/templates';
import { contentAssetPath, createContentAssets } from '../../src/stores/content-assets';
import { fakeClock, openTestDb, tempDir } from '../helpers';

const DAY = 24 * 3600_000;
const code = (result: { ok: boolean; error?: { code: string } }) => (result.ok ? 'ok' : result.error?.code);
const bytesOf = (text: string) => new TextEncoder().encode(text);

function setup(options: { insert?: 'once' | 'or-keep' } = {}) {
  const clock = fakeClock();
  const db = openTestDb({ file: false, clock: clock.now });
  const dir = join(tempDir(), 'assets');
  const assets = createContentAssets<'image/jpeg' | 'image/webp'>(db, dir, {
    entity: 'sheet',
    table: templateAssets,
    sha256: templateAssets.sha256,
    mediaTypes: ['image/jpeg'],
    maxBytes: 8,
    keepUnusedMs: DAY,
    insert: (row) => {
      const insert = db.orm.insert(templateAssets).values(row);
      (options.insert === 'once' ? insert : insert.onConflictDoNothing()).run();
    },
    unused: (cutoff) => lt(templateAssets.createdAt, cutoff),
  });
  return { clock, db, dir, assets };
}

describe('content-addressed assets', () => {
  it('stores bytes once under their sha256, file and row', async () => {
    const { dir, assets } = setup();
    const put = unwrap(await assets.put(bytesOf('sheet'), 'image/jpeg'));
    expect(put.bytes).toBe(5);
    expect(unwrap(await assets.put(bytesOf('sheet'), 'image/jpeg'))).toEqual(put);
    const path = unwrap(assets.path(put.sha256));
    expect(path).toBe(contentAssetPath(dir, put.sha256));
    expect(path).toBe(join(dir, put.sha256.slice(0, 2), put.sha256));
    expect(readdirSync(join(dir, put.sha256.slice(0, 2)))).toEqual([put.sha256]);
  });

  it("refuses what its kind doesn't accept", async () => {
    const { dir, assets } = setup();
    expect(code(await assets.put(bytesOf('sheet'), 'image/webp'))).toBe('core.validation');
    expect(code(await assets.put(new Uint8Array(), 'image/jpeg'))).toBe('core.validation');
    expect(code(await assets.put(bytesOf('nine byte'), 'image/jpeg'))).toBe('core.validation');
    expect(existsSync(dir)).toBe(false);
  });

  it("names its kind's entity when the row can't be written, and keeps the file for the sweep", async () => {
    const { dir, assets } = setup({ insert: 'once' });
    const put = unwrap(await assets.put(bytesOf('sheet'), 'image/jpeg'));
    const again = await assets.put(bytesOf('sheet'), 'image/jpeg');
    expect(again.ok ? undefined : again.error).toMatchObject({
      code: 'library.conflict',
      params: { entity: 'sheet' },
    });
    expect(existsSync(contentAssetPath(dir, put.sha256))).toBe(true);
  });

  it('finds a path only for a well-formed sha256 with both its row and its file', async () => {
    const { dir, assets } = setup();
    expect(code(assets.path('../etc'))).toBe('core.validation');
    expect(code(assets.path('a'.repeat(64)))).toBe('core.not_found');
    const put = unwrap(await assets.put(bytesOf('sheet'), 'image/jpeg'));
    rmSync(contentAssetPath(dir, put.sha256));
    const missing = assets.path(put.sha256);
    expect(missing.ok ? undefined : missing.error).toMatchObject({
      code: 'core.not_found',
      params: { entity: 'sheet', id: put.sha256 },
    });
  });

  it("prunes the rows its kind calls unused, then old files that have no row, and isn't fooled by other folders", async () => {
    const { clock, dir, assets } = setup();
    const old = unwrap(await assets.put(bytesOf('old'), 'image/jpeg'));
    clock.advance(2 * DAY);
    const fresh = unwrap(await assets.put(bytesOf('fresh'), 'image/jpeg'));
    const stray = join(dir, 'ab', 'ab'.padEnd(64, '0'));
    const inFlight = join(dir, 'cd', 'cd'.padEnd(64, '0'));
    const notABucket = join(dir, 'notes', 'keep');
    for (const path of [stray, inFlight, notABucket]) {
      mkdirSync(join(path, '..'), { recursive: true });
      writeFileSync(path, '');
    }
    const anHourAgo = new Date(Date.now() - 3600_000);
    for (const path of [stray, contentAssetPath(dir, old.sha256)]) utimesSync(path, anHourAgo, anHourAgo);

    expect(unwrap(assets.prune())).toBe(1);
    expect(code(assets.path(old.sha256))).toBe('core.not_found');
    expect(existsSync(contentAssetPath(dir, old.sha256))).toBe(false);
    expect(unwrap(assets.path(fresh.sha256))).toBe(contentAssetPath(dir, fresh.sha256));
    expect(existsSync(stray)).toBe(false);
    expect(existsSync(inFlight)).toBe(true); // younger than a put's grace
    expect(existsSync(notABucket)).toBe(true);
    clock.advance(1);
    expect(unwrap(assets.prune(0))).toBe(1); // a caller's own age
  });
});
