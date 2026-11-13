// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LIB1-FIND: the runner over a small stored library (three clips, one shot each, a frame vector per shot along its
 * own axis) with a stand-in embedder: it copies the library, scores each query through `createLibrarySearch`,
 * groups the scores by kind and language, and skips what it can't score.
 */
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ok, RationalTime, TimeRange, unwrap } from '@taalcut/core';
import { createRepositories, openDatabase, openVectorIndex, sqliteVecPath } from '@taalcut/library';
import { EMBEDDING_SPACE, type VisionEmbedder } from '@taalcut/vision';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FIND_CANDIDATES } from '../../../src/search/find/candidates';
import { FIND_LIBRARY, type FindManifest } from '../../../src/search/find/fetch';
import { findMarkdown } from '../../../src/search/find/report';
import { runFindEval } from '../../../src/search/find/run';
import { mergeQueries, type FindQuery, type OwnerSet } from '../../../src/search/find/schema';

const CLIPS = ['dance-rabha', 'halong-bay', 'owner-1'];
const axis = (n: number) =>
  Float32Array.from({ length: EMBEDDING_SPACE.dimensions }, (_, i) => (i === n ? 1 : 0));
const manifest: FindManifest = {
  library: FIND_LIBRARY,
  clips: CLIPS.map((id) => ({
    id,
    asset: id.startsWith('owner-') ? `owner/${id}.mp4` : `commons/${id}.mp4`,
  })),
};

const COMMITTED: FindQuery[] = [
  { id: 'dance', language: 'en', kind: 'action', text: 'dance', relevant: ['dance-rabha'] },
  { id: 'bay', language: 'hi', kind: 'scene', text: 'खाड़ी', relevant: ['halong-bay'] },
  { id: 'gone', language: 'en', kind: 'scene', text: 'rain', relevant: ['rain-rome'] },
];
const OWNER: OwnerSet = {
  v: 1,
  about: '',
  clips: [{ id: 'owner-1', shows: 'a made-up clip', file: 'x.mp4' }],
  relevant: { dance: ['owner-1'] },
  queries: [
    { id: 'trip', language: 'en', kind: 'place', text: 'my trip', relevant: ['owner-1'], needs: 'places' },
  ],
};
const QUERIES = mergeQueries(COMMITTED, OWNER);
/** Query vectors: "dance" sits between the two dance clips' axes, nearer the Commons one. */
const QUERY_VECTORS: Record<string, Float32Array> = {
  dance: Float32Array.from(axis(0), (v, i) => (i === 2 ? 0.6 : v)),
  खाड़ी: axis(1),
};

const embedder = {
  space: EMBEDDING_SPACE,
  embedTexts: async (texts: readonly string[]) => ok(texts.map((text) => QUERY_VECTORS[text] ?? axis(99))),
} as unknown as VisionEmbedder;

let dir: string;
let library: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'taalcut-find-run-'));
  library = join(dir, 'library.db');
  const db = unwrap(openDatabase({ path: library, extensions: [sqliteVecPath()] }));
  const index = unwrap(
    openVectorIndex(db, { name: EMBEDDING_SPACE.indexName, dimensions: EMBEDDING_SPACE.dimensions }),
  );
  const repos = createRepositories(db);
  const source = unwrap(
    repos.sources.add({ kind: 'watched_folder', displayName: 'eval', rootPath: '/eval' }),
  );
  const rate = { num: 30, den: 1 };
  manifest.clips.forEach(({ asset: path }, n) => {
    const asset = unwrap(
      repos.assets.create({ kind: 'video', sizeBytes: 1000, originalFilename: `clip-${n}.mp4` }),
    );
    unwrap(
      repos.assetLocations.add({
        assetId: asset.id,
        sourceId: source.id,
        storage: 'referenced',
        relativePath: path,
        sizeBytes: 1000,
        state: 'present',
      }),
    );
    const [shot] = unwrap(
      repos.shots.replaceForAsset(asset.id, 0, [
        TimeRange.of(RationalTime.of(0, rate), RationalTime.of(150, rate)),
      ]),
    );
    unwrap(
      index.upsert([
        { id: `frame:${shot}:0`, vector: axis(n), metadata: { assetId: asset.id, kind: 'frame' } },
      ]),
    );
  });
  db.close();
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('runFindEval', () => {
  it('scores each query through the app’s search, by kind and language, and skips what it can’t score', async () => {
    const before = statSync(library).mtimeMs;
    const report = await runFindEval({
      libraryDb: library,
      manifest,
      queries: QUERIES,
      descriptions: null,
      candidates: FIND_CANDIDATES,
      workDir: join(dir, 'work'),
      embedder,
      media: {} as never,
      tier: 'recommended',
      tempDir: dir,
      log: () => {},
    });
    expect(statSync(library).mtimeMs).toBe(before);
    const dance = report.results.find((r) => r.query === 'dance')!;
    expect(dance.top.map((hit) => hit.clip).slice(0, 2)).toEqual(['dance-rabha', 'owner-1']);
    // Commons scores leave the owner clip out; the owner set's count it.
    expect(dance.relevant).toEqual(['dance-rabha']);
    expect(dance.score).toMatchObject({ rank: 1, recallAt10: 1, hitAt1: 1, rPrecision: 1 });
    expect(dance.owner).toMatchObject({
      relevant: ['dance-rabha', 'owner-1'],
      score: { rank: 1, rPrecision: 1 },
    });
    expect(report.results.find((r) => r.query === 'bay')?.score?.rank).toBe(1);
    expect(report.results.find((r) => r.query === 'bay')?.owner).toBeUndefined();
    expect(report.skipped.map((s) => s.query)).toEqual(['gone', 'trip']);
    const all = report.groups.find((g) => g.group === 'all')!;
    expect(all).toMatchObject({ candidate: 'v2', queries: 2, mrr: 1 });
    expect(report.groups.map((g) => g.group)).toEqual(
      expect.arrayContaining(['kind:action', 'kind:scene', 'language:en', 'language:hi', 'owner:all']),
    );
    expect(report.groups.find((g) => g.group === 'owner:all')).toMatchObject({ queries: 1, mrr: 1 });
    expect(report.library).toEqual({ clips: 3, owner: true, places: false });
    expect(report.descriptions).toMatchObject({ label: 'undescribed', described: 0, shots: 3 });
    expect(findMarkdown(report)).toContain(
      '| v2 (search-fusion-v2) | 2 | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 |',
    );
  });
});
