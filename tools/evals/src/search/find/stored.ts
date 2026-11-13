// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The find eval's indexed library, as `find index` left it (`library.db`, frames, on-screen text and their
 * vectors), and the descriptions added to a copy of it: vision's own `vision.describe` stage runs on every asset
 * through the app's job handler, its model answering through `ClipModels` (a live server or a recording), and
 * the handler stores the descriptions and their vectors as the app does. The stored file is never written: each
 * run copies it into its work folder.
 */
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { AssetId, VectorIndex } from '@taalcut/core';
import {
  createStageRows,
  openDatabase,
  openVectorIndex,
  sqliteVecPath,
  stagePlan,
  type LibraryDatabase,
} from '@taalcut/library';
import type { DecodeService, MediaContext } from '@taalcut/media';
import {
  createVisionIndexStages,
  EMBEDDING_SPACE,
  indexJobRegistrations,
  type Tier,
  type VisionEmbedder,
} from '@taalcut/vision';
import { EVAL_INDEX_STAGES, runStage } from '../library-index';
import type { FindManifest } from './fetch';
import type { ClipModels } from './models';

export interface FindLibrary {
  readonly db: LibraryDatabase;
  readonly vectors: VectorIndex;
  /** Each asset's clip id (the manifest's). */
  readonly clipOf: ReadonlyMap<AssetId, string>;
  close(): void;
}

/** Copies `source` to `workDir/<label>.db` and opens the copy; every asset must be a manifest clip. */
export function openFindLibrary(
  source: string,
  manifest: FindManifest,
  workDir: string,
  label: string,
): FindLibrary {
  mkdirSync(workDir, { recursive: true });
  const copy = join(workDir, `${label}.db`);
  copyFileSync(source, copy);
  const opened = openDatabase({ path: copy, extensions: [sqliteVecPath()] });
  if (!opened.ok) throw new Error(`${source}: ${opened.error.code} ${opened.error.detail ?? ''}`);
  const db = opened.value;
  const vectors = openVectorIndex(db, {
    name: EMBEDDING_SPACE.indexName,
    dimensions: EMBEDDING_SPACE.dimensions,
  });
  if (!vectors.ok) {
    db.close();
    throw new Error(`${source}: no ${EMBEDDING_SPACE.indexName} vectors (${vectors.error.code})`);
  }
  const idOf = new Map(manifest.clips.map((clip) => [clip.asset, clip.id]));
  const clipOf = new Map<AssetId, string>();
  for (const row of db.driver
    .prepare('SELECT asset_id AS asset, relative_path AS path FROM asset_locations')
    .all()) {
    const id = idOf.get(String(row.path));
    if (!id) {
      db.close();
      throw new Error(`${source}: ${String(row.path)} is not in the manifest`);
    }
    clipOf.set(String(row.asset) as AssetId, id);
  }
  return { db, vectors: vectors.value, clipOf, close: () => db.close() };
}

export interface DescribeOptions {
  readonly media: MediaContext;
  readonly embedder: VisionEmbedder;
  readonly models: ClipModels;
  readonly tier: Tier;
  readonly tempDir: string;
  readonly decodeService?: DecodeService;
  readonly log: (line: string) => void;
}

/** Runs `vision.describe` on every asset of the library; returns the failures, `<clip>: <code>`. */
export async function describeLibrary(library: FindLibrary, options: DescribeOptions): Promise<string[]> {
  const deps = {
    media: options.media,
    tier: options.tier,
    embedder: options.embedder,
    index: library.vectors,
    background: options.models,
    tempDir: options.tempDir,
    ...(options.decodeService ? { decodeService: options.decodeService } : {}),
  };
  const handlers = new Map(indexJobRegistrations(deps).map((r) => [r.kind.kind, r]));
  const all = createVisionIndexStages({
    tier: options.tier,
    ocrLanguages: () => [],
    placement: () => 'local',
  });
  const stages = [...EVAL_INDEX_STAGES, 'vision.describe'].map((name) => all.find((s) => s.stage === name)!);
  const describe = stages.at(-1)!;
  createStageRows(library.db).seed(stagePlan(describe, stages));
  const failures: string[] = [];
  const started = Date.now();
  for (const [assetId, clip] of library.clipOf) {
    options.models.forClip(clip);
    const failed = await runStage(library.db, describe, handlers, assetId);
    if (failed) failures.push(`${clip}: ${failed}`);
  }
  options.log(
    `vision.describe: ${library.clipOf.size} clips in ${((Date.now() - started) / 1000).toFixed(1)} s`,
  );
  return failures;
}
