// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** A library with watched folders on a fake volume, for the scanner, relink and watcher tests. */
import { randomBytes } from 'node:crypto';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { newId, unwrap, type AssetId, type SourceId } from '@taalcut/core';
import {
  createRepositories,
  createWasmContentHasher,
  scanSource,
  type ContentHasher,
  type LibraryDatabase,
  type ScanRequest,
  type VolumeProbe,
} from '../../src/index';
import { openTestDb, tempDir } from '../helpers';

export const VOLUME = 'VOL-1';

/** One mounted volume, VOL-1, unless told which are mounted. */
export function fakeVolumes(mounted: readonly string[] = [VOLUME]): VolumeProbe {
  return {
    identify: async () => ({ uuid: VOLUME, name: 'Disk', mountPoint: '/' }),
    mountedUuids: async () => new Set(mounted),
  };
}

/** Counts calls, so tests can say what was (and wasn't) read. */
export function countingHasher(inner: ContentHasher = createWasmContentHasher()) {
  const calls = { full: [] as string[], partial: [] as string[] };
  const hasher: ContentHasher = {
    full: (path, options) => (calls.full.push(path), inner.full(path, options)),
    partial: (path, options) => (calls.partial.push(path), inner.partial(path, options)),
  };
  return { hasher, calls };
}

export function writeMedia(root: string, relativePath: string, bytes: Uint8Array | number = 4096): string {
  const path = join(root, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof bytes === 'number' ? randomBytes(bytes) : bytes);
  return path;
}

export function library(options: { volumes?: VolumeProbe; db?: LibraryDatabase } = {}) {
  const db = options.db ?? openTestDb();
  const repos = createRepositories(db);
  const counting = countingHasher();
  const volumes = options.volumes ?? fakeVolumes();
  const addFolder = (name = 'Trip', extra: { volumeUuid?: string | null } = {}) => {
    const root = join(realpathSync(tempDir()), name);
    mkdirSync(root, { recursive: true });
    const source = unwrap(
      repos.sources.add({
        kind: 'watched_folder',
        displayName: name,
        rootPath: root,
        volumeUuid: extra.volumeUuid === undefined ? VOLUME : extra.volumeUuid,
      }),
    );
    return { id: source.id as SourceId, root };
  };
  const scan = async (
    request: ScanRequest,
    deps: { hasher?: ContentHasher; signal?: AbortSignal; batchSize?: number } = {},
  ) =>
    unwrap(
      await scanSource(
        {
          db,
          hasher: deps.hasher ?? counting.hasher,
          volumes,
          ...(deps.batchSize ? { batchSize: deps.batchSize } : {}),
        },
        request,
        deps.signal,
      ),
    );
  const locations = (sourceId?: SourceId) =>
    db.driver
      .prepare(
        `SELECT l.id, l.asset_id AS assetId, l.source_id AS sourceId, l.relative_path AS path, l.state, l.via,
                l.missing_since AS missingSince, a.availability, a.detached_at AS detachedAt
           FROM asset_locations l JOIN assets a ON a.id = l.asset_id
          ${sourceId ? 'WHERE l.source_id = ?' : ''} ORDER BY l.relative_path`,
      )
      .all(...(sourceId ? [sourceId] : []))
      .map((row) => ({ ...row }) as Record<string, unknown>);
  const assetCount = () => Number(db.driver.prepare('SELECT count(*) AS n FROM assets').get()!.n);
  return {
    db,
    repos,
    volumes,
    hasher: counting.hasher,
    calls: counting.calls,
    addFolder,
    scan,
    locations,
    assetCount,
  };
}

/** Gives an asset one analysed shot, so a test can check that a relink keeps its analysis. */
export function addAnalysedShot(db: LibraryDatabase, assetId: AssetId): string {
  const id = newId<'Shot'>();
  db.driver
    .prepare(
      `INSERT INTO shots (id, asset_id, index_in_asset, start_value, start_rate_num, start_rate_den,
         duration_value, duration_rate_num, duration_rate_den, analysis, description, created_at)
       VALUES (?, ?, 0, 0, 25, 1, 50, 25, 1, ?, 'sunset on the beach', 1)`,
    )
    .run(id, assetId, JSON.stringify({ version: 1, note: 'analysed' }));
  return id;
}

export function shotsOf(db: LibraryDatabase, assetId: string) {
  return db.driver.prepare('SELECT id, description FROM shots WHERE asset_id = ?').all(assetId);
}
