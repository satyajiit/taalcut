// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Performance baselines for the library database (plan: record on each
 * reference machine, compare in CI later). Measures, on a temporary database
 * that is deleted afterwards:
 *
 * - creating a database and running every migration;
 * - opening an existing database (≈300 MB with 100k vectors) in a fresh
 *   process, with and without the quick integrity check (median of 5);
 * - top-10 kNN over 100k × 768 vectors (median and p95 of 30 queries after 3
 *   warm-ups), and one filtered query.
 *
 *   pnpm --filter @taalcut/library bench                writes bench/<cpu>.json
 *   pnpm --filter @taalcut/library bench --out x.json   writes x.json
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { cpus, platform, arch, tmpdir, totalmem } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unwrap } from '@taalcut/core';
import {
  LIBRARY_MIGRATIONS,
  openDatabase,
  openVectorIndex,
  sqliteVecPath,
  sqliteVecVersion,
  type VectorItem,
} from '../src/index';
import { seededRandom } from '../test/vector-helpers';

const COUNT = 100_000;
const DIMS = 768;
const BATCH = 10_000;
const QUERIES = 30;
const OPENS = 5;
const PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url));

const round = (ms: number) => Math.round(ms * 100) / 100;
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
const percentile = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;
const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

function openInFreshProcess(path: string, check: 'quick' | 'off'): number {
  const out = execFileSync(
    process.execPath,
    ['--import', 'tsx', join(PACKAGE_DIR, 'scripts/bench-open.ts'), path, check],
    {
      cwd: PACKAGE_DIR,
      encoding: 'utf8',
    },
  );
  return (JSON.parse(out.trim()) as { ms: number }).ms;
}

const cpu = cpus()[0]?.model ?? 'unknown';
const outIndex = process.argv.indexOf('--out');
const outPath = outIndex > 0 ? process.argv[outIndex + 1]! : join(PACKAGE_DIR, 'bench', `${slug(cpu)}.json`);
const dir = mkdtempSync(join(tmpdir(), 'taalcut-bench-'));

try {
  const path = join(dir, 'library.db');
  const createStart = performance.now();
  const db = unwrap(openDatabase({ path, extensions: [sqliteVecPath()] }));
  const createAndMigrateMs = performance.now() - createStart;
  const sqlite = String(db.driver.prepare('SELECT sqlite_version() AS v').get()?.v);
  const vec = sqliteVecVersion(db.driver) ?? 'unknown';

  const index = unwrap(openVectorIndex(db, { name: 'bench', dimensions: DIMS }));
  const random = seededRandom(20261012);
  const loadStart = performance.now();
  for (let start = 0; start < COUNT; start += BATCH) {
    const batch: VectorItem[] = [];
    for (let i = start; i < start + BATCH; i++) {
      const vector = Float32Array.from({ length: DIMS }, random);
      batch.push({
        id: `v${i}`,
        vector,
        metadata: { assetId: `a${i % 2000}`, kind: i % 4 === 0 ? 'frame' : 'text' },
      });
    }
    unwrap(index.upsert(batch));
  }
  db.driver.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  const loadMs = performance.now() - loadStart;

  const times: number[] = [];
  const queries = Array.from({ length: QUERIES + 3 }, () => Float32Array.from({ length: DIMS }, random));
  queries.forEach((query, i) => {
    const t0 = performance.now();
    unwrap(index.search(query, { k: 10 }));
    if (i >= 3) times.push(performance.now() - t0);
  });
  times.sort((a, b) => a - b);
  const filteredStart = performance.now();
  unwrap(index.search(queries[0]!, { k: 10, filter: { kind: 'frame' } }));
  const filteredMs = performance.now() - filteredStart;
  db.close();

  const fileMb = statSync(path).size / 1_000_000;
  const quick = Array.from({ length: OPENS }, () => openInFreshProcess(path, 'quick'));
  const off = Array.from({ length: OPENS }, () => openInFreshProcess(path, 'off'));

  const result = {
    schema: 1,
    recordedAt: new Date().toISOString(),
    machine: {
      cpu,
      cores: cpus().length,
      memoryGb: Math.round(totalmem() / 2 ** 30),
      platform: platform(),
      arch: arch(),
      node: process.version,
      sqlite,
      sqliteVec: vec,
    },
    database: {
      migrations: LIBRARY_MIGRATIONS.length,
      vectors: COUNT,
      dimensions: DIMS,
      fileMb: round(fileMb),
    },
    createAndMigrateMs: round(createAndMigrateMs),
    openMs: {
      note: 'fresh process, OS file cache warm',
      quickCheck: { median: round(median(quick)), runs: quick.map(round) },
      noCheck: { median: round(median(off)), runs: off.map(round) },
    },
    knn: {
      k: 10,
      queries: QUERIES,
      medianMs: round(percentile(times, 50)),
      p95Ms: round(percentile(times, 95)),
      minMs: round(times[0]!),
      filteredMs: round(filteredMs),
    },
    vectorLoadSeconds: round(loadMs / 1000),
  };
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\nWrote ${outPath}\n`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
