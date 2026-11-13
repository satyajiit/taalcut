// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P2-L10 machinery targets: search p95 ≤ 150 ms over 100k shots excluding the query embedding, find
 * similar p95 ≤ 50 ms. Those bounds are for the M1 runner; this Mac records its own numbers. The
 * library is generated here (768-dimension vectors as EmbeddingGemma 2 writes them: a frame and a
 * description per shot, transcript segments for a fifth of the files), nothing is committed. It
 * takes a while, so it runs with TAALCUT_SEARCH_BENCH=1 (CI's nightly job sets it).
 */
import { ok, unwrap, type Embedder, type ShotId, type VectorItem } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createLibrarySearch, createRepositories, openVectorIndex, sqliteVecPath } from '../../src/index';
import { openTestDb } from '../helpers';
import { seededRandom } from '../vector-helpers';

const SHOTS = Number(process.env.TAALCUT_SEARCH_BENCH_SHOTS ?? 100_000);
const PER_ASSET = 5;
const DIMS = 768;
const QUERIES = 30;
const MAX_SEARCH_P95 = Number(process.env.TAALCUT_SEARCH_BENCH_MAX_MS ?? 150);
const MAX_SIMILAR_P95 = Number(process.env.TAALCUT_SIMILAR_BENCH_MAX_MS ?? 50);
const WORDS = [
  'sunset',
  'beach',
  'city',
  'night',
  'dog',
  'park',
  'market',
  'food',
  'dance',
  'wedding',
  'mountain',
  'snow',
  'office',
  'laptop',
  'kids',
  'sand',
  'waves',
  'traffic',
  'fireworks',
  'diwali',
  'समुद्र',
  'सूर्यास्त',
  'playa',
  'atardecer',
  'praia',
  'pôr',
  'sol',
  'mercado',
  'rua',
  'noite',
];

const p = (sorted: number[], q: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;

function build() {
  const db = openTestDb({ extensions: [sqliteVecPath()] });
  const index = unwrap(openVectorIndex(db, { name: 'bench_search', dimensions: DIMS }));
  const random = seededRandom(20261013);
  const word = () => WORDS[Math.floor((random() + 0.5) * WORDS.length) % WORDS.length]!;
  const vector = () => Float32Array.from({ length: DIMS }, random);
  const source = unwrap(
    createRepositories(db).sources.add({ kind: 'watched_folder', displayName: 'Bench', rootPath: '/bench' }),
  );
  const now = db.clock();
  const asset = db.driver.prepare(
    `INSERT INTO assets (id, kind, size_bytes, original_filename, availability, created_at, updated_at,
       orientation, capture_time, language) VALUES (?, 'video', 1000, ?, 'missing', ?, ?, ?, ?, ?)`,
  );
  const location = db.driver.prepare(
    `INSERT INTO asset_locations (id, asset_id, source_id, storage, relative_path, size_bytes, state)
     VALUES (?, ?, ?, 'referenced', ?, 1000, 'present')`,
  );
  const shot = db.driver.prepare(
    `INSERT INTO shots (id, asset_id, index_in_asset, start_value, start_rate_num, start_rate_den,
       duration_value, duration_rate_num, duration_rate_den, description, objects, place, quality,
       transcript_text, created_at) VALUES (?, ?, ?, ?, 30, 1, 90, 30, 1, ?, ?, ?, ?, ?, ?)`,
  );
  const transcript = db.driver.prepare(
    `INSERT INTO transcripts (asset_id, transcript, language, engine, local, text, generation, created_at)
     VALUES (?, ?, 'en', 'parakeet', 1, ?, 0, ?)`,
  );
  const started = performance.now();
  const shotIds: ShotId[] = [];
  let batch: VectorItem[] = [];
  const flush = () => {
    unwrap(index.upsert(batch));
    batch = [];
  };
  for (let a = 0; a * PER_ASSET < SHOTS; a++) {
    db.transaction(() => {
      const assetId = `A${String(a).padStart(25, '0')}`;
      const speech = `${word()} ${word()} ${word()} ${word()}`;
      asset.run(
        assetId,
        `${word()}-${a}.mov`,
        now,
        now,
        a % 2 ? 'portrait' : 'landscape',
        now - a * 1000,
        'en',
      );
      location.run(`L${String(a).padStart(25, '0')}`, assetId, source.id, `f/${a}.mov`);
      for (let n = 0; n < PER_ASSET; n++) {
        const id = `S${String(a * PER_ASSET + n).padStart(25, '0')}` as ShotId;
        const text = `${word()} ${word()} with ${word()} and ${word()}`;
        shot.run(
          id,
          assetId,
          n,
          n * 90,
          text,
          `${word()}\u001f${word()}`,
          word(),
          (random() + 0.5) * 0.9,
          speech,
          now,
        );
        shotIds.push(id);
        const metadata = { assetId, sourceId: source.id };
        batch.push({ id: `frame:${id}:0`, vector: vector(), metadata: { ...metadata, kind: 'frame' } });
        batch.push({
          id: `description:${id}`,
          vector: vector(),
          metadata: { ...metadata, kind: 'description' },
        });
      }
      if (a % 5 === 0) {
        const at = (v: number) => ({ value: v, rate: { num: 1000, den: 1 } });
        const segment = {
          text: speech,
          range: { start: at(4000), duration: at(2000) },
          words: [],
          language: 'en',
        };
        const json = {
          version: 1,
          language: 'en',
          segments: [segment],
          engine: 'parakeet',
          model: 'm',
          local: true,
          wordTiming: 'native',
        };
        transcript.run(assetId, JSON.stringify(json), speech, now);
        batch.push({
          id: `transcript:${assetId}:0`,
          vector: vector(),
          metadata: { assetId, kind: 'transcript' },
        });
      }
    });
    if (batch.length >= 10_000) flush();
  }
  flush();
  db.driver.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  return { db, index, shotIds, random, vector, word, loadMs: performance.now() - started };
}

describe.runIf(process.env.TAALCUT_SEARCH_BENCH === '1')('search benchmark', () => {
  it(
    `searches ${SHOTS} shots (p95 ≤ ${MAX_SEARCH_P95} ms) and finds similar (p95 ≤ ${MAX_SIMILAR_P95} ms)`,
    { timeout: 600_000 },
    async () => {
      const b = build();
      const queries = new Map<string, Float32Array>();
      const embedder: Embedder = {
        space: { model: 'bench', revision: '1', dimensions: DIMS, indexName: 'bench_search' },
        embedTexts: async (texts) => ok(texts.map((t) => queries.get(t) ?? b.vector())),
      };
      const search = createLibrarySearch({ db: b.db, vectors: b.index, embedder });
      const texts = Array.from({ length: QUERIES + 3 }, (_, i) => `${b.word()} ${b.word()} ${i}`);
      for (const text of texts) queries.set(text, b.vector());

      const searchMs: number[] = [];
      for (const [i, text] of texts.entries()) {
        const found = unwrap(
          await search.search(text, i % 3 === 0 ? { orientations: ['portrait'] } : undefined, 30),
        );
        expect(found.hits.length).toBeGreaterThan(0);
        if (i >= 3) searchMs.push(found.tookMs); // the first three warm the caches
      }
      const similarMs: number[] = [];
      for (let i = 0; i < QUERIES + 3; i++) {
        const shotId = b.shotIds[Math.floor((b.random() + 0.5) * b.shotIds.length) % b.shotIds.length]!;
        const found = unwrap(await search.findSimilar(shotId, undefined, 30, true));
        if (i >= 3) similarMs.push(found.tookMs);
      }
      searchMs.sort((x, y) => x - y);
      similarMs.sort((x, y) => x - y);
      process.stdout.write(
        `[search bench] ${SHOTS} shots, ${b.index.count()} × ${DIMS} vectors, built in ${(b.loadMs / 1000).toFixed(1)} s; ` +
          `search median ${p(searchMs, 0.5)} ms, p95 ${p(searchMs, 0.95)} ms; ` +
          `find similar median ${p(similarMs, 0.5)} ms, p95 ${p(similarMs, 0.95)} ms\n`,
      );
      expect(p(searchMs, 0.95)).toBeLessThanOrEqual(MAX_SEARCH_P95);
      expect(p(similarMs, 0.95)).toBeLessThanOrEqual(MAX_SIMILAR_P95);
    },
  );
});
