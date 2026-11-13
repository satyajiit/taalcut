// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The pipeline's test queue and loop (src/test-support.ts), and a watched folder of assets. */
import { unwrap, type AssetId, type AssetKind, type SourceId } from '@taalcut/core';
import { createRepositories, type LibraryDatabase } from '../../src/index';

export { createTestQueue, runPipeline, type StubHandler, type TestQueue } from '../../src/test-support';

/** A watched folder with `kinds.length` assets, each with a present location. */
export function addAssets(
  db: LibraryDatabase,
  kinds: readonly AssetKind[],
  options: { sourceName?: string; state?: 'present' | 'offline' } = {},
): { sourceId: SourceId; assets: AssetId[] } {
  const repos = createRepositories(db);
  const name = options.sourceName ?? 'Trip';
  const sourceId = unwrap(
    repos.sources.add({ kind: 'watched_folder', displayName: name, rootPath: `/Users/test/${name}` }),
  ).id;
  const assets = kinds.map((kind, i) => {
    const asset = unwrap(
      repos.assets.create({ kind, sizeBytes: 1000 + i, originalFilename: `clip-${i}.${kind}` }),
    );
    unwrap(
      repos.assetLocations.add({
        assetId: asset.id,
        sourceId,
        storage: 'referenced',
        relativePath: `clip-${i}`,
        sizeBytes: asset.sizeBytes,
        state: options.state ?? 'present',
      }),
    );
    return asset.id;
  });
  return { sourceId, assets };
}
