// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX2-U1: the study runner over a small stored library (three of the search eval's clips, one shot each, a frame
 * vector per shot along its own axis) with cached query vectors: it copies the library, runs each candidate's
 * fusion through `createLibrarySearch`, scores the ranks per language and kind, and refuses a probe whose query
 * vector isn't cached.
 */
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RationalTime, TimeRange, unwrap } from '@taalcut/core';
import {
  createRepositories,
  openDatabase,
  openVectorIndex,
  SEARCH_FUSION_V1,
  sqliteVecPath,
} from '@taalcut/library';
import { EMBEDDING_SPACE } from '@taalcut/vision';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LabelledProbe } from '../../../src/search/study/labels';
import { encodeVector, writeQueryVectors } from '../../../src/search/study/query-vectors';
import { runStudy } from '../../../src/search/study/run';

const CLIPS = ['clips/en-market.mkv', 'clips/es-playa.mkv', 'clips/desk.mkv'];
const axis = (n: number) =>
  Float32Array.from({ length: EMBEDDING_SPACE.dimensions }, (_, i) => (i === n ? 1 : 0));

let dir: string;
let library: string;
let vectors: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'taalcut-study-run-'));
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
  CLIPS.forEach((path, n) => {
    const asset = unwrap(
      repos.assets.create({ kind: 'video', sizeBytes: 1000, originalFilename: `clip-00${n + 1}.mkv` }),
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
        TimeRange.of(RationalTime.of(0, rate), RationalTime.of(5, rate)),
      ]),
    );
    unwrap(
      index.upsert([
        { id: `frame:${shot}:0`, vector: axis(n), metadata: { assetId: asset.id, kind: 'frame' } },
      ]),
    );
  });
  db.close();
  vectors = join(dir, 'query-vectors.json');
  writeQueryVectors(vectors, {
    v: 1,
    space: EMBEDDING_SPACE.indexName,
    dimensions: EMBEDDING_SPACE.dimensions,
    device: 'test',
    vectors: { 'the market stall': encodeVector(axis(0)), 'en la playa': encodeVector(axis(1)) },
  });
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

const probe = (
  id: string,
  language: LabelledProbe['language'],
  text: string,
  asset: string,
): LabelledProbe => ({
  id,
  set: 'synthetic-search',
  language,
  kind: 'on-screen',
  text,
  relevant: [{ asset }],
});

describe('runStudy', () => {
  it('scores each candidate’s ranks per library, language and kind, on a copy of the library', async () => {
    const before = statSync(library).mtimeMs;
    const report = await runStudy({
      probes: [
        probe('market', 'en', 'the market stall', 'clips/en-market.mkv'),
        // Labelled with the wrong clip on purpose: its first relevant hit comes second.
        probe('playa', 'es', 'en la playa', 'clips/desk.mkv'),
      ],
      vectors,
      libraries: [{ label: 'tiny', path: library }],
      candidates: [{ id: 'v1', about: 'RRF', fusion: SEARCH_FUSION_V1 }],
      workDir: join(dir, 'work'),
    });
    expect(statSync(library).mtimeMs).toBe(before);
    expect(existsSync(join(dir, 'work', 'tiny.sqlite'))).toBe(true);
    expect(report.libraries).toEqual([{ label: 'tiny', set: 'synthetic-search', path: library }]);
    expect(report.results.map((r) => [r.probe, r.rank])).toEqual([
      ['market', 1],
      ['playa', 2],
    ]);
    expect(report.results[0]?.top[0]).toMatchObject({
      asset: 'clips/en-market.mkv',
      from: 0,
      matchedBy: ['visual'],
    });
    const score = (group: string) => report.scores.find((s) => s.group === group);
    expect(score('all')).toMatchObject({ probes: 2, hitAt1: 0.5, hitAt5: 1, mrr: 0.75 });
    expect(score('es')).toMatchObject({ probes: 1, hitAt1: 0, mrr: 0.5 });
    expect(score('on-screen')).toMatchObject({ probes: 2 });
    expect(report.bench).toEqual([]);
  });

  it('refuses to score a probe whose query vector isn’t cached', async () => {
    await expect(
      runStudy({
        probes: [probe('desk', 'en', 'desk', 'clips/desk.mkv')],
        vectors,
        libraries: [{ label: 'tiny', path: library }],
        candidates: [{ id: 'v1', about: 'RRF', fusion: SEARCH_FUSION_V1 }],
        workDir: join(dir, 'work2'),
      }),
    ).rejects.toThrow(/tiny "desk": no cached query vector/);
  });
});
