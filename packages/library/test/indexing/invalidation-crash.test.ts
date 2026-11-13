// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX3-I3: a crash between a stage's write and its digest leaves a state the pipeline finishes. A child process
 * re-indexes with new shots and is SIGKILLed inside the transaction that stores them, as it takes vision.shots'
 * digest. Nothing of that transaction is left (the old shots, the old digest, the readers still done), the stage is
 * still running with its finished job, and a new process's reconcile stores the shots, records the new digest and
 * re-runs the stages that read them.
 */
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEventBus, systemClock, unwrap, type AssetId } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import {
  createIndexingPipeline,
  createStageRows,
  openDatabase,
  openVectorIndex,
  sqliteVecPath,
  type LibraryDatabase,
} from '../../src/index';
import { tempDir } from '../helpers';
import { addAssets, createTestQueue, runPipeline } from './harness';
import { readingStages, risen, type World } from './reading-stages';

const CHILD = fileURLToPath(new URL('./invalidation-child.ts', import.meta.url));
const PACKAGE_DIR = fileURLToPath(new URL('../..', import.meta.url));
const extensions = [sqliteVecPath()];
const READERS = ['vision.analyse', 'vision.ocr', 'vision.embed', 'vision.describe'];

async function index(db: LibraryDatabase, world: World, rise: string[]) {
  const vectors = unwrap(openVectorIndex(db, { name: 'stub', dimensions: 8 }));
  const events = createEventBus({ clock: systemClock });
  const reading = readingStages(db, vectors, world);
  const queue = createTestQueue(db, events, reading.handlers);
  const stages = risen(reading.stages, rise);
  const pipeline = createIndexingPipeline({
    db,
    queue,
    events,
    stages,
    vectors: () => vectors,
    log: () => {},
  });
  await pipeline.start({ poll: false });
  await runPipeline(pipeline, queue);
  pipeline.stop();
  return reading.runs;
}

async function runUntilKilled(path: string): Promise<string[]> {
  const child = spawn(process.execPath, ['--import', 'tsx', CHILD, path], {
    cwd: PACKAGE_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
  const [code, signal] = await new Promise<[number | null, string | null]>((resolve) =>
    child.on('close', (c, s) => resolve([c, s])),
  );
  if (signal !== 'SIGKILL') throw new Error(`child exited with ${code}: ${stderr}`);
  return stdout.split('\n').filter(Boolean);
}

const shotStarts = (db: LibraryDatabase, asset: AssetId) =>
  (
    db.driver
      .prepare('SELECT start_value AS s FROM shots WHERE asset_id = ? ORDER BY index_in_asset')
      .all(asset) as { s: number }[]
  ).map((row) => row.s);
const digestOf = (db: LibraryDatabase, asset: AssetId, stage: string) =>
  createStageRows(db).get(asset, stage)?.outputDigest ?? null;

describe('a crash between a stage’s write and its digest', () => {
  it(
    'leaves nothing of the transaction, and the next process finishes it',
    { timeout: 120_000 },
    async () => {
      const path = join(tempDir(), 'library.db');
      const setup = unwrap(openDatabase({ path, extensions }));
      const [asset] = addAssets(setup, ['video']).assets as [AssetId];
      await index(setup, { cuts: [150], text: {}, silent: false }, []);
      const before = digestOf(setup, asset, 'vision.shots');
      setup.close();

      expect(await runUntilKilled(path)).toEqual(['killed']);

      const db = unwrap(openDatabase({ path, extensions }));
      try {
        const rows = createStageRows(db);
        // The new shots, their digest and the readers' resets were one transaction: none of it is there.
        expect(shotStarts(db, asset)).toEqual([0, 150]);
        expect(digestOf(db, asset, 'vision.shots')).toBe(before);
        const shots = rows.get(asset, 'vision.shots');
        expect(shots?.state).toBe('running');
        const job = db.driver.prepare('SELECT state FROM jobs WHERE id = ?').get(shots?.jobId ?? '');
        expect(job).toEqual({ state: 'succeeded' });
        for (const stage of READERS) expect(rows.get(asset, stage)?.state, stage).toBe('done');

        // A new process: reconcile stores the finished job's shots, digest and resets, then the readers run.
        const runs = await index(db, { cuts: [90, 200], text: {}, silent: false }, ['vision.shots']);
        expect(shotStarts(db, asset)).toEqual([0, 90, 200]);
        expect(rows.get(asset, 'vision.shots')?.state).toBe('done');
        expect(digestOf(db, asset, 'vision.shots')).not.toBe(before);
        expect(runs.get(`vision.shots ${asset}`)).toBeUndefined();
        for (const stage of READERS) {
          expect(runs.get(`${stage} ${asset}`), stage).toBe(1);
          expect(rows.get(asset, stage)?.state, stage).toBe('done');
        }
      } finally {
        db.close();
      }
    },
  );
});
