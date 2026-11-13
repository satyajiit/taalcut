// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRepositories, openDatabase, type LibraryDatabase } from '@taalcut/library';
import { afterEach, describe, expect, it } from 'vitest';
import { runnerPerfSystem } from '../../src/adapters/perf';
import { indexBenchmark, peakMemory } from '../../src/perf/inputs';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'taalcut-perf-inputs-'));
  dirs.push(dir);
  return dir;
}

/** Two 30 s clips at 30 fps whose stages ran from t=1000 to t=1000+90 s, and an older row outside the window. */
function indexedLibrary(path: string): LibraryDatabase {
  const opened = openDatabase({ path });
  if (!opened.ok) throw new Error(opened.error.code);
  const db = opened.value;
  const repos = createRepositories(db);
  const stage = db.driver.prepare(
    `INSERT INTO asset_index_stages (asset_id, stage, state, version, updated_at, started_at, finished_at)
     VALUES (?, ?, 'done', 1, ?, ?, ?)`,
  );
  for (const n of [0, 1]) {
    const created = repos.assets.create({ kind: 'video', sizeBytes: 1000, originalFilename: `c${n}.mov` });
    if (!created.ok) throw new Error(created.error.code);
    const id = created.value.id;
    db.driver
      .prepare(
        `UPDATE assets SET duration_value = 900, duration_rate_num = 30, duration_rate_den = 1 WHERE id = ?`,
      )
      .run(id);
    stage.run(id, 'vision.shots', 0, 1000 + n * 40_000, 1000 + n * 40_000 + 20_000);
    stage.run(id, 'vision.embed', 0, 1000 + n * 40_000 + 20_000, 1000 + n * 40_000 + 50_000);
  }
  return db;
}

describe('perf inputs', () => {
  it('scales the pipeline wall clock to minutes per hour of footage', () => {
    const db = indexedLibrary(join(tempDir(), 'library.db'));
    try {
      const index = indexBenchmark(db, 0);
      // 90 s of wall clock for 60 s of footage: 1.5 minutes of indexing per minute, 90 per hour.
      expect(index).toMatchObject({ wallMs: 90_000, footageSeconds: 60, assets: 2 });
      expect(index.indexMinutes).toBeCloseTo(90, 6);
      expect(() => indexBenchmark(db, 10_000_000)).toThrow(/no index stage finished/);
    } finally {
      db.close();
    }
  });

  it('takes the peak per process across samples, summing processes that share a name', () => {
    const sample = (main: number, tabs: number[], jobs: number) =>
      JSON.stringify([
        { type: 'Browser', memory: { workingSetSize: main, peakWorkingSetSize: main } },
        ...tabs.map((kb) => ({ type: 'Tab', memory: { workingSetSize: kb, peakWorkingSetSize: 0 } })),
        { type: 'Utility', name: 'Taalcut jobs', memory: { workingSetSize: jobs, peakWorkingSetSize: jobs } },
      ]);
    const peaks = peakMemory([sample(100, [50, 25], 300), sample(120, [10], 200), ''].join('\n'));
    expect(peaks).toEqual({ main: 120 * 1024, renderer: 75 * 1024, jobs: 300 * 1024 });
    expect(() => peakMemory('\n')).toThrow(/no app.getAppMetrics/);
  });

  it('reads one sample from the benchmark outputs and refuses a missing one', async () => {
    const dir = tempDir();
    indexedLibrary(join(dir, 'library.db')).close();
    writeFileSync(
      join(dir, 'preview.json'),
      JSON.stringify({ medianFps: 30, p5Fps: 28.5, droppedFrames: 3 }),
    );
    writeFileSync(join(dir, 'render.json'), JSON.stringify({ seconds: 41.2 }));
    writeFileSync(
      join(dir, 'metrics.jsonl'),
      `${JSON.stringify({ metrics: [{ type: 'Browser', memory: { workingSetSize: 10, peakWorkingSetSize: 12 } }] })}\n`,
    );
    const options = {
      libraryDb: join(dir, 'library.db'),
      preview: join(dir, 'preview.json'),
      render: join(dir, 'render.json'),
      appMetrics: join(dir, 'metrics.jsonl'),
    };
    const sample = await runnerPerfSystem(options).measure({ footage: 'synthetic', runnerId: 'test' });
    expect(sample).toMatchObject({
      previewMedianFps: 30,
      previewP5Fps: 28.5,
      droppedFrames: 3,
      renderSeconds: 41.2,
      memoryBytes: { main: 12 * 1024 },
    });
    expect(sample.indexMinutes).toBeCloseTo(90, 6);
    const missing = runnerPerfSystem({ ...options, render: join(dir, 'nope.json') });
    await expect(missing.measure({ footage: 'synthetic', runnerId: 'test' })).rejects.toThrow(
      /render benchmark: .*nope.json is missing/,
    );
  });
});
