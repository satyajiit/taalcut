// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P2-L13 "Done when": quitting mid-index resumes where it stopped. A child
 * process indexes with stub stage handlers and is SIGKILLed in the middle of
 * a stage (its vectors written, its job not completed). A new process
 * reclaims the job (as the engine does at start), reconciles and finishes:
 * no finished stage runs again, and there are no duplicate rows or vectors.
 */
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEventBus, systemClock, unwrap, type AssetId } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import {
  createIndexingPipeline,
  createJobRepository,
  createRepositories,
  openDatabase,
  openVectorIndex,
  sqliteVecPath,
} from '../../src/index';
import { tempDir } from '../helpers';
import { addAssets, createTestQueue, runPipeline } from './harness';
import { KINDS, stubStages } from './stages';

const CHILD = fileURLToPath(new URL('./index-child.ts', import.meta.url));
const PACKAGE_DIR = fileURLToPath(new URL('../..', import.meta.url));
const extensions = [sqliteVecPath()];

const KIND_OF: Record<string, string> = {
  'library.hash': KINDS.hash.kind,
  'media.normalise': KINDS.normalise.kind,
  'vision.shots': KINDS.shots.kind,
  'vision.analyse': KINDS.analyse.kind,
  'audio.transcript': KINDS.transcript.kind,
  'vision.embed': KINDS.embed.kind,
};

async function runUntilKilled(path: string, target: AssetId): Promise<string[]> {
  const child = spawn(process.execPath, ['--import', 'tsx', CHILD, path, target], {
    cwd: PACKAGE_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const lines: string[] = [];
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
  const [code, signal] = await new Promise<[number | null, string | null]>((resolve) =>
    child.on('close', (c, s) => resolve([c, s])),
  );
  lines.push(...stdout.split('\n').filter(Boolean));
  if (signal !== 'SIGKILL') throw new Error(`child exited with ${code}: ${stderr}`);
  return lines;
}

describe('indexing resumes after a quit', () => {
  it(
    'finishes where it stopped, rerunning only the stage that was cut off',
    { timeout: 120_000 },
    async () => {
      const path = join(tempDir(), 'library.db');
      const setup = unwrap(openDatabase({ path, extensions }));
      const { assets } = addAssets(setup, ['video', 'video', 'image', 'audio', 'video']);
      setup.close();
      const target = assets[0]!;

      const lines = await runUntilKilled(path, target);
      expect(lines.at(-1)).toBe('killed');
      expect(lines.filter((l) => l.startsWith('done')).length).toBeGreaterThan(5);

      const db = unwrap(openDatabase({ path, extensions }));
      try {
        // What finished before the quit.
        const finished = db.driver
          .prepare(`SELECT asset_id, stage FROM asset_index_stages WHERE state IN ('done', 'skipped')`)
          .all() as { asset_id: AssetId; stage: string }[];
        const cut = db.driver
          .prepare(`SELECT state FROM asset_index_stages WHERE asset_id = ? AND stage = 'vision.embed'`)
          .get(target);
        expect(cut?.state).toBe('running');
        expect(finished.length).toBeGreaterThan(0);
        const remaining = Number(
          db.driver
            .prepare(`SELECT COUNT(*) AS n FROM asset_index_stages WHERE state NOT IN ('done', 'skipped')`)
            .get()?.n,
        );
        expect(remaining).toBeGreaterThan(1);

        // A new jobs process: the engine takes back the dead process's jobs, then the pipeline starts.
        unwrap(createJobRepository(db).reclaimRunning());
        const vectors = unwrap(openVectorIndex(db, { name: 'stub', dimensions: 8 }));
        const events = createEventBus({ clock: systemClock });
        const stub = stubStages(db, { vectors });
        const queue = createTestQueue(db, events, stub.handlers);
        const pipeline = createIndexingPipeline({ db, queue, events, stages: stub.stages, log: () => {} });
        await pipeline.start({ poll: false });
        await runPipeline(pipeline, queue);
        pipeline.stop();

        const states = db.driver.prepare(`SELECT DISTINCT state FROM asset_index_stages`).all();
        expect(states.every((s) => s.state === 'done' || s.state === 'skipped')).toBe(true);
        for (const { asset_id, stage } of finished)
          expect(
            stub.runs.get(`${KIND_OF[stage]} ${asset_id}`),
            `${stage} reran for ${asset_id}`,
          ).toBeUndefined();
        expect(stub.runs.get(`${KINDS.embed.kind} ${target}`)).toBe(1);

        // No duplicate rows or vectors.
        const repos = createRepositories(db);
        const videos = assets.filter((_, i) => [0, 1, 4].includes(i));
        for (const id of videos) expect(repos.shots.listByAsset(id)).toHaveLength(2);
        expect(vectors.count()).toBe(videos.length * 2);
        expect(Number(db.driver.prepare('SELECT COUNT(*) AS n FROM transcripts').get()?.n)).toBe(4);
        const live = db.driver
          .prepare(
            `SELECT idempotency_key, COUNT(*) AS n FROM jobs WHERE state = 'succeeded'
           GROUP BY idempotency_key HAVING n > 1`,
          )
          .all();
        expect(live).toEqual([]);
      } finally {
        db.close();
      }
    },
  );
});
