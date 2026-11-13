// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { dirname, basename, relative } from 'node:path';
import { err, ok, type AssetId, type AsyncResult, type SourceId } from '@taalcut/core';
import { createWasmContentHasher } from '../../hashing/content-hasher';
import { createSourceRepository } from '../../repositories/sources';
import { hashAsset } from '../../sources/hash-asset';
import { scanSource } from '../../sources/scanner';
import type { LocalImportAdapterDeps } from './types';
import type { CaptureFile } from './camera-profiles';
import { ImportSelectionUnavailable } from './errors';

/** Uses the existing source scanner and hash merge; no second reference indexing path. */
export async function referenceLocalFile(
  deps: LocalImportAdapterDeps,
  file: CaptureFile,
  watch: boolean,
  signal: AbortSignal,
  sourceRoot?: string,
  recursive = true,
): AsyncResult<{ assetId: AssetId; sourceId: SourceId; duplicate: boolean }> {
  const root = sourceRoot ?? dirname(file.path);
  const sources = createSourceRepository(deps.db);
  let source = sources.list({ kinds: ['watched_folder'] }).find((candidate) => candidate.rootPath === root);
  if (!source) {
    const volume = await deps.volumes.identify(root);
    const added = sources.add({
      kind: 'watched_folder',
      displayName: basename(root),
      rootPath: root,
      watch,
      volumeUuid: volume?.uuid ?? null,
      volumeName: volume?.name ?? null,
    });
    if (!added.ok) return added;
    source = added.value;
  }
  if (watch) {
    sources.update(source.id, { watch: true });
    deps.db.driver
      .prepare(
        'INSERT INTO import_source_scopes (source_id, recursive) VALUES (?, ?) ON CONFLICT(source_id) DO UPDATE SET recursive = excluded.recursive',
      )
      .run(source.id, recursive ? 1 : 0);
  }
  const hasher = createWasmContentHasher();
  const scanned = await scanSource(
    { db: deps.db, volumes: deps.volumes, hasher, ...(deps.events ? { events: deps.events } : {}) },
    { sourceId: source.id, mode: 'paths', paths: [relative(root, file.path)] },
    signal,
  );
  if (!scanned.ok) return scanned;
  const row = deps.db.driver
    .prepare('SELECT asset_id FROM asset_locations WHERE source_id = ? AND absolute_path_cached = ?')
    .get(source.id, file.path);
  if (!row) return err(ImportSelectionUnavailable());
  const assetId = String(row['asset_id']) as AssetId;
  const hashed = await hashAsset(
    { db: deps.db, hasher, ...(deps.events ? { events: deps.events } : {}) },
    { assetId, generation: 0 },
    signal,
  );
  if (!hashed.ok) return hashed;
  return ok({
    assetId: hashed.value.merged ?? assetId,
    sourceId: source.id,
    duplicate: !!hashed.value.merged,
  });
}
