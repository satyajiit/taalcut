// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The lan process's ImportSink: it opens the library only when first asked, and USB "Only new" reads the
 * library's own answer (an asset the library still has is known; one it trashed is not).
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createContainer, createEventBus, EventBusToken, newId, unwrap } from '@taalcut/core';
import { createRepositories, openDatabase } from '@taalcut/library';
import { describe, expect, it, onTestFinished } from 'vitest';
import { hostPlatform, PlatformServicesToken } from '../src/platform';
import { LibraryDatabaseToken } from '../src/shared/tokens';
import { libraryImportSink } from '../src/utility/roots/library-lan';

const insertAsset = `INSERT INTO assets (id, kind, size_bytes, original_filename, availability, created_at, updated_at)
  VALUES (?, 'video', 1, 'clip.mov', 'online', 1, 1)`;

describe('the lan process’s import sink', () => {
  it('answers knownAssets from the library, opening it on first use', async () => {
    const db = unwrap(openDatabase({ path: ':memory:' }));
    onTestFinished(() => db.close());
    const root = await mkdtemp(join(tmpdir(), 'taalcut-lan-sink-'));
    onTestFinished(() => rm(root, { recursive: true, force: true }));
    let opened = 0;
    const container = createContainer()
      .value(EventBusToken, createEventBus({ clock: { now: () => 1 } }))
      .value(PlatformServicesToken, hostPlatform())
      .factory(LibraryDatabaseToken, () => {
        opened += 1;
        return db;
      });
    const sink = libraryImportSink(container);
    expect(opened).toBe(0);
    const kept = newId<'Asset'>();
    const trashed = newId<'Asset'>();
    db.driver.prepare(insertAsset).run(kept);
    db.driver.prepare(insertAsset).run(trashed);
    const repos = createRepositories(db);
    const source = unwrap(
      repos.sources.add({ kind: 'watched_folder', displayName: 'Clips', rootPath: root }),
    );
    const path = join(root, 'clip.mov');
    await writeFile(path, 'a');
    for (const assetId of [kept, trashed])
      unwrap(
        repos.assetLocations.add({
          assetId,
          sourceId: source.id,
          storage: 'referenced',
          relativePath: 'clip.mov',
          absolutePathCached: path,
          sizeBytes: 1,
          state: 'present',
        }),
      );
    db.driver.prepare('UPDATE assets SET trashed_at = 1 WHERE id = ?').run(trashed);
    const known = unwrap(await sink.knownAssets([kept, trashed, newId<'Asset'>()]));
    expect([...known]).toEqual([kept]);
    expect(opened).toBe(1);
    await rm(path);
    expect([...unwrap(await sink.knownAssets([kept]))]).toEqual([]);
  });
});
