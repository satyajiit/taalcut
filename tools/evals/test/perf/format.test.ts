// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { type PerfSample } from '../../src/adapters/types';
import { syntheticPerfSystem } from '../../src/adapters/synthetic-perf';
import { main } from '../../src/perf/cli';
import { appendRows, readRows, rowsFromSample, sampleMedian, type PerfRunMeta } from '../../src/perf/measure';
import { parsePerfRow } from '../../src/perf/schema';
import { runPerf } from '../../src/perf/run';
import { type GhClient } from '../../src/perf/issue';

const sample: PerfSample = {
  indexMinutes: 30,
  previewMedianFps: 30,
  previewP5Fps: 28,
  droppedFrames: 0,
  renderSeconds: 55,
  memoryBytes: { main: 1, renderer: 1, agent: 1, jobs: 1, render: 1 },
};

const meta: PerfRunMeta = {
  runner: { id: 'm1-8gb', chip: 'apple-m1', memoryGb: 8, macos: '15.0' },
  commit: 'deadbeef',
  date: '2026-10-13T02:00:00.000Z',
  synthetic: true,
  footage: 'synthetic',
  build: { flavour: 'synthetic', version: '0.0.0' },
};

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'taalcut-perf-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('perf JSONL', () => {
  it('writes one schema-valid line per metric, with v 1 and better', () => {
    const rows = rowsFromSample(sample, meta);
    expect(rows.map((row) => row.metric)).toEqual([
      'index-1h',
      'preview-fps',
      'preview-fps-p5',
      'dropped-frames',
      'render-60s',
      'memory:main',
      'memory:renderer',
      'memory:agent',
      'memory:jobs',
      'memory:render',
    ]);
    expect(rows.find((row) => row.metric === 'index-1h')).toMatchObject({
      unit: 'minutes',
      better: 'lower',
      value: 30,
    });
    expect(rows.find((row) => row.metric === 'preview-fps')).toMatchObject({ unit: 'fps', better: 'higher' });
    expect(rows.find((row) => row.metric === 'preview-fps-p5')).toMatchObject({
      unit: 'fps',
      better: 'higher',
      value: 28,
    });
    expect(rows.find((row) => row.metric === 'dropped-frames')).toMatchObject({
      unit: 'frames',
      better: 'lower',
    });
    expect(rows.find((row) => row.metric === 'render-60s')).toMatchObject({
      unit: 'seconds',
      better: 'lower',
      value: 55,
    });
    expect(rows.find((row) => row.metric === 'memory:main')).toMatchObject({
      unit: 'bytes',
      better: 'lower',
      value: 1,
    });

    const dir = tempDir();
    const path = join(dir, 'nested', 'm1-8gb.jsonl');
    appendRows(path, rows);
    const text = readFileSync(path, 'utf8');
    const lines = text.trim().split('\n');
    expect(lines).toHaveLength(rows.length);
    for (const line of lines) {
      expect(line.startsWith('{')).toBe(true);
      expect(line.endsWith('}')).toBe(true);
      expect(line).toContain('"v":1');
      expect(line).toContain('"better":');
      const parsed = parsePerfRow(JSON.parse(line) as unknown);
      expect(parsed.v).toBe(1);
      expect(parsed.better === 'lower' || parsed.better === 'higher').toBe(true);
    }

    const second = rowsFromSample(
      { ...sample, indexMinutes: 31 },
      { ...meta, date: '2026-10-14T02:00:00.000Z' },
    );
    appendRows(path, second);
    const back = readRows(path);
    expect(back).toHaveLength(rows.length * 2);
    expect(back[0]?.metric).toBe('index-1h');
    expect(back[0]?.value).toBe(30);
    expect(back[rows.length]?.value).toBe(31);
    expect(back.every((row) => row.v === 1)).toBe(true);
  });

  it('names the line number when a JSONL line is invalid', () => {
    const dir = tempDir();
    const path = join(dir, 'bad.jsonl');
    const [good] = rowsFromSample(sample, meta);
    writeFileSync(path, `${JSON.stringify(good)}\n{"v":2}\n`);
    expect(() => readRows(path)).toThrow(/line 2/);
  });
});

describe('sampleMedian', () => {
  it('keeps the middle of three runs', async () => {
    const index = [10, 40, 20];
    const memory = [3, 9, 6];
    let call = 0;
    const sample = await sampleMedian(
      {
        async measure() {
          const at = call;
          call += 1;
          return {
            indexMinutes: index[at] ?? 0,
            previewMedianFps: 30,
            previewP5Fps: 28,
            droppedFrames: 0,
            renderSeconds: 55,
            memoryBytes: { main: memory[at] ?? 0 },
          };
        },
      },
      { footage: 'synthetic', runnerId: 'm1-8gb' },
    );
    expect(call).toBe(3);
    expect(sample.indexMinutes).toBe(20);
    expect(sample.memoryBytes.main).toBe(6);
  });
});

describe('runPerf', () => {
  it('appends, dry-runs a regression, and does not call gh or git', async () => {
    const dir = tempDir();
    const outPath = join(dir, 'results', 'm1-8gb.jsonl');
    const calls: string[] = [];
    const client: GhClient = {
      async listOpen() {
        calls.push('list');
        return [];
      },
      async create() {
        calls.push('create');
        return { number: 1, title: 'nope' };
      },
      async comment() {
        calls.push('comment');
      },
    };
    let published = 0;
    const first = await runPerf({
      system: syntheticPerfSystem(),
      outPath,
      meta,
      fileIssues: false,
      client,
      publish: () => {
        published += 1;
      },
    });
    expect(first.regressions).toEqual([]);
    expect(first.rows).toHaveLength(10);
    expect(first.trendsMarkdown).toContain('index-1h');
    expect(readFileSync(join(dir, 'results', 'TRENDS.md'), 'utf8')).toContain('# Performance trends');

    const second = await runPerf({
      system: syntheticPerfSystem({ indexMinutes: 40 }),
      outPath,
      meta: { ...meta, date: '2026-10-14T02:00:00.000Z' },
      fileIssues: false,
      client,
    });
    expect(readRows(outPath)).toHaveLength(20);
    expect(second.regressions.map((item) => item.metric)).toEqual(['index-1h']);
    const hit = second.regressions[0];
    expect(hit?.action).toBe('dry-run');
    expect(hit?.command).toContain('perf-regression');
    expect(hit?.command).toContain('Perf: index-1h on m1-8gb');
    expect(calls).toEqual([]);
    expect(published).toBe(1);
  });

  it('shows a noisy row’s regression and never files it (IX-F3)', async () => {
    const outPath = join(tempDir(), 'm1-8gb.jsonl');
    const extra = (value: number, date: string, noisy?: string[]) =>
      parsePerfRow({
        v: 1,
        suite: 'perf',
        metric: 'index-searchable-1h:ix-v1',
        unit: 'minutes',
        value,
        better: 'lower',
        runner: meta.runner,
        commit: 'c',
        date,
        synthetic: true,
        footage: 'synthetic',
        build: meta.build,
        ...(noisy ? { noisy } : {}),
      });
    const calls: string[] = [];
    const client: GhClient = {
      listOpen: async () => (calls.push('list'), []),
      create: async () => (calls.push('create'), { number: 1, title: 'x' }),
      comment: async () => void calls.push('comment'),
    };
    await runPerf({
      system: syntheticPerfSystem(),
      outPath,
      meta,
      extraRows: [extra(10, meta.date)],
      fileIssues: true,
      client,
    });
    const noisy = await runPerf({
      system: syntheticPerfSystem(),
      outPath,
      meta: { ...meta, date: '2026-10-14T02:00:00.000Z' },
      extraRows: [extra(20, '2026-10-14T02:00:00.000Z', ['run 2: load 20'])],
      fileIssues: true,
      client,
    });
    expect(noisy.regressions).toMatchObject([
      {
        metric: 'index-searchable-1h:ix-v1',
        action: 'skipped',
        command: 'skipped: noisy run (run 2: load 20)',
      },
    ]);
    expect(calls).toEqual([]);
  });
});

describe('perf cli', () => {
  it('exits 1 when a real run lacks the benchmark outputs', async () => {
    const errors: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args.map(String).join(' '));
    };
    try {
      const code = await main(['--out', join(tempDir(), 'out.jsonl'), '--runner', 'm1-8gb']);
      expect(code).toBe(1);
      expect(errors.join('\n')).toContain('missing --library-db, --preview, --render, --app-metrics');
    } finally {
      console.error = original;
    }
  });

  it('writes a synthetic file and exits 0 without filing issues', async () => {
    const dir = tempDir();
    const out = join(dir, 'out.jsonl');
    const logs: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    };
    try {
      const code = await main(['--', '--out', out, '--runner', 'm1-8gb', '--synthetic']);
      expect(code).toBe(0);
    } finally {
      console.log = original;
    }
    expect(readRows(out)).toHaveLength(10);
    expect(logs.join('\n')).toContain('not publishing');
    expect(logs.join('\n')).toContain('no regressions');
  });

  it('exits 1 when required arguments are missing', async () => {
    const code = await main(['--synthetic']);
    expect(code).toBe(1);
  });
});
