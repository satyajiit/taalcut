// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * library.collect (daily): assets detached for 30 days go, with their
 * vectors, unless a timeline uses them; the vector and auto-version clean-ups
 * are the stores' own and are only called.
 */
import { newId, ok, unwrap, type AssetId } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { collect, DETACHED_RETENTION_MS } from '../../src/index';
import { fakeClock, openTestDb } from '../helpers';
import { library, writeMedia } from './fixture';

describe('library.collect', () => {
  it('deletes assets detached for 30 days that no timeline uses, and their vectors', async () => {
    const clock = fakeClock();
    const db = openTestDb({ clock: clock.now });
    const lib = library({ db });
    const { id, root } = lib.addFolder();
    writeMedia(root, 'used.mov');
    writeMedia(root, 'unused.mov');
    writeMedia(root, 'recent.mov');
    await lib.scan({ sourceId: id, mode: 'full' });
    const ids = Object.fromEntries(lib.locations(id).map((l) => [String(l.path), l.assetId as AssetId]));
    unwrap(lib.repos.sources.remove(id)); // All three detached now.
    clock.advance(DETACHED_RETENTION_MS + 1);
    // "recent" was detached later (re-attached and detached again).
    db.driver.prepare('UPDATE assets SET detached_at = ? WHERE id = ?').run(clock.now(), ids['recent.mov']!);
    // A timeline uses "used".
    const projectId = newId<'Project'>();
    const timelineId = newId<'Timeline'>();
    db.driver
      .prepare('INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, 1, 1)')
      .run(projectId, 'P');
    db.driver
      .prepare(
        `INSERT INTO timelines (id, project_id, name, schema_version, document, revision, clip_count,
           duration_value, duration_rate_num, duration_rate_den, created_at, updated_at)
         VALUES (?, ?, 'T', 1, '{}', 1, 1, 0, 25, 1, 1, 1)`,
      )
      .run(timelineId, projectId);
    db.driver
      .prepare('INSERT INTO timeline_asset_refs (timeline_id, asset_id) VALUES (?, ?)')
      .run(timelineId, ids['used.mov']!);

    const removedVectorsFor: AssetId[][] = [];
    const result = unwrap(
      await collect({
        db,
        removeVectors: (assetIds) => (removedVectorsFor.push([...assetIds]), ok(assetIds.length * 3)),
        removeOrphanVectors: () => ok(2),
        pruneAutoVersions: () => ok(5),
        pruneTemplateAssets: () => ok(4),
        pruneStyleAssets: () => ok(3),
      }),
    );
    expect(result).toEqual({ assets: 1, vectors: 5, autos: 5, templateAssets: 4, styleAssets: 3 });
    expect(removedVectorsFor).toEqual([[ids['unused.mov']]]);
    const left = db.driver
      .prepare('SELECT id FROM assets ORDER BY id')
      .all()
      .map((r) => r.id);
    expect(left.sort()).toEqual([ids['recent.mov'], ids['used.mov']].sort());
  });
});
