// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A library copy as small as the timeline needs: assets, jobs and stage rows (the columns the bench reads),
 * optionally the ready lane's searchable_at and complete_at and the stage rows' outputs, with times in ms from
 * Add folder.
 *
 * Two videos, A and B, with stages hash (io) → shots (gpu) → embed (gpu) → describe (gpu). The gpu class runs
 * one job at a time, so A.shots, B.shots, A.embed, B.embed take turns; B's describe is skipped.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { PipelineGraph } from '../../../src/perf/bench/run-record';
import { runRecord } from '../bench/fixtures';

export const ADDED = 1_800_000_000_000;

export interface FixtureStage {
  readonly asset: 'A' | 'B';
  readonly stage: string;
  readonly kind: string | null;
  readonly resource: string | null;
  readonly state?: string;
  /** Ms from Add folder; a skipped stage has only `finished`. */
  readonly queued?: number;
  readonly started?: number;
  readonly finished: number;
}

export const STAGES: readonly FixtureStage[] = [
  {
    asset: 'A',
    stage: 'library.hash',
    kind: 'library.hashAsset',
    resource: 'io',
    queued: 100,
    started: 110,
    finished: 200,
  },
  {
    asset: 'B',
    stage: 'library.hash',
    kind: 'library.hashAsset',
    resource: 'io',
    queued: 100,
    started: 120,
    finished: 210,
  },
  {
    asset: 'A',
    stage: 'vision.shots',
    kind: 'vision.detectShots',
    resource: 'gpu',
    queued: 210,
    started: 220,
    finished: 1220,
  },
  {
    asset: 'B',
    stage: 'vision.shots',
    kind: 'vision.detectShots',
    resource: 'gpu',
    queued: 215,
    started: 1225,
    finished: 3225,
  },
  {
    asset: 'A',
    stage: 'vision.embed',
    kind: 'vision.embedAsset',
    resource: 'gpu',
    queued: 1230,
    started: 3230,
    finished: 4230,
  },
  {
    asset: 'B',
    stage: 'vision.embed',
    kind: 'vision.embedAsset',
    resource: 'gpu',
    queued: 3230,
    started: 4235,
    finished: 5235,
  },
  {
    asset: 'A',
    stage: 'vision.describe',
    kind: 'vision.describeShots',
    resource: 'gpu',
    queued: 4230,
    started: 5240,
    finished: 5300,
  },
  { asset: 'B', stage: 'vision.describe', kind: null, resource: null, state: 'skipped', finished: 5236 },
];

export const PIPELINE: PipelineGraph = {
  stages: [
    { stage: 'library.hash', version: 1, needs: [], appliesTo: ['video'], milestone: null },
    { stage: 'vision.shots', version: 1, needs: ['library.hash'], appliesTo: ['video'], milestone: null },
    { stage: 'vision.embed', version: 1, needs: ['vision.shots'], appliesTo: ['video'], milestone: null },
    { stage: 'vision.describe', version: 1, needs: ['vision.embed'], appliesTo: ['video'], milestone: null },
  ],
  kinds: {
    'vision.embedAsset': { resource: 'gpu', lane: 'vision.embedder' },
    'vision.detectShots': { resource: 'gpu', lane: null },
  },
};

export const record = (pipeline: PipelineGraph = PIPELINE) =>
  runRecord({ addedAt: ADDED, settledAt: ADDED + 5400, videoSeconds: 120, pipeline });

export interface LibraryOptions {
  readonly stages?: readonly FixtureStage[];
  readonly searchable?: Readonly<Record<'A' | 'B', number | null>>;
  /** With `searchable`: the ready lane's complete_at too. */
  readonly complete?: Readonly<Record<'A' | 'B', number | null>>;
  /** Stage rows' output JSON, keyed `<asset> <stage>`. */
  readonly outputs?: Readonly<Record<string, string>>;
  /** The sched lane's order_key column: A's jobs 1, B's 2. */
  readonly orderKey?: boolean;
}

const at = (ms: number | null | undefined) => (ms === null || ms === undefined ? null : ADDED + ms);

function writeStages(db: DatabaseSync, stages: readonly FixtureStage[]): void {
  const job = db.prepare('INSERT INTO jobs VALUES (?, ?, ?, ?, ?, ?, ?)');
  const stage = db.prepare('INSERT INTO asset_index_stages VALUES (?, ?, ?, ?, ?, ?, ?)');
  for (const [index, row] of stages.entries()) {
    const jobId = row.kind === null ? null : `job-${index}`;
    if (jobId !== null && row.kind !== null && row.resource !== null)
      job.run(jobId, row.kind, 'succeeded', row.resource, at(row.queued), at(row.started), at(row.finished));
    const state = row.state ?? 'done';
    const reason = state === 'skipped' ? 'indexing.skip.x' : null;
    stage.run(row.asset, row.stage, state, reason, jobId, at(row.started), at(row.finished));
  }
}

/** The ready lane's table: searchable_at, and complete_at when given. */
function writeStored(db: DatabaseSync, options: LibraryOptions): void {
  if (!options.searchable) return;
  const complete = options.complete;
  db.exec(
    `CREATE TABLE asset_index_state (asset_id TEXT PRIMARY KEY, searchable_at INTEGER${complete ? ', complete_at INTEGER' : ''})`,
  );
  const put = db.prepare(`INSERT INTO asset_index_state VALUES (?, ?${complete ? ', ?' : ''})`);
  for (const asset of ['A', 'B'] as const)
    if (complete) put.run(asset, at(options.searchable[asset]), at(complete[asset]));
    else put.run(asset, at(options.searchable[asset]));
}

function writeOutputs(db: DatabaseSync, outputs: Readonly<Record<string, string>>): void {
  db.exec('ALTER TABLE asset_index_stages ADD COLUMN output TEXT');
  const put = db.prepare('UPDATE asset_index_stages SET output = ? WHERE asset_id = ? AND stage = ?');
  for (const [key, output] of Object.entries(outputs)) {
    const [asset = '', stage = ''] = key.split(' ');
    put.run(output, asset, stage);
  }
}

export function writeLibrary(path: string, options: LibraryOptions = {}): void {
  const db = new DatabaseSync(path);
  try {
    db.exec(`
      CREATE TABLE assets (id TEXT PRIMARY KEY, kind TEXT, original_filename TEXT);
      CREATE TABLE jobs (id TEXT PRIMARY KEY, kind TEXT, state TEXT, resource_class TEXT, created_at INTEGER,
                         started_at INTEGER, finished_at INTEGER);
      CREATE TABLE asset_index_stages (asset_id TEXT, stage TEXT, state TEXT, reason_key TEXT, job_id TEXT,
                                       started_at INTEGER, finished_at INTEGER);
      INSERT INTO assets VALUES ('A', 'video', 'a.mov'), ('B', 'video', 'b.mov');
      INSERT INTO jobs VALUES ('scan', 'library.scanSource', 'succeeded', 'io', ${ADDED + 1}, ${ADDED + 5}, ${ADDED + 90});
    `);
    writeStages(db, options.stages ?? STAGES);
    if (options.orderKey)
      db.exec(`ALTER TABLE jobs ADD COLUMN order_key INTEGER;
        UPDATE jobs SET order_key = (SELECT CASE s.asset_id WHEN 'A' THEN 1 ELSE 2 END
                                       FROM asset_index_stages s WHERE s.job_id = jobs.id)`);
    writeStored(db, options);
    if (options.outputs) writeOutputs(db, options.outputs);
  } finally {
    db.close();
  }
}

/** A library in a fresh temp folder (`dirs` collects it for the test's cleanup); its path. */
export function tempLibrary(dirs: string[], options: LibraryOptions = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'taalcut-timeline-'));
  dirs.push(dir);
  const path = join(dir, 'index-library.sqlite');
  writeLibrary(path, options);
  return path;
}
