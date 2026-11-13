// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { evalShots, main } from '../../src/shots/cli';
import { storedPredictions } from '../../src/shots/stored';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'shots-eval-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** The library tables the reader touches, with two assets: one at 30 fps, one stored at 60 fps. */
function library(): string {
  const path = join(dir, 'index-library.sqlite');
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE assets (id TEXT PRIMARY KEY, original_filename TEXT);
    CREATE TABLE shots (id TEXT, asset_id TEXT, index_in_asset INTEGER, start_value INTEGER,
      start_rate_num INTEGER, start_rate_den INTEGER);
    CREATE TABLE asset_index_stages (asset_id TEXT, stage TEXT, output TEXT);
    INSERT INTO assets VALUES ('a', 'a.mp4'), ('b', 'b.mov'), ('c', 'unlabelled.mp4');
    INSERT INTO shots VALUES ('s1', 'a', 0, 0, 30, 1), ('s2', 'a', 1, 100, 30, 1), ('s3', 'a', 2, 466, 30, 1),
      ('t1', 'b', 0, 0, 60, 1), ('t2', 'b', 1, 600, 60, 1), ('u1', 'c', 0, 0, 30, 1);
    INSERT INTO asset_index_stages VALUES
      ('a', 'vision.shots', '{"detector":"model","cuts":[{"frame":100},{"frame":466,"kind":"dissolve","span":{"from":450,"to":480}}]}'),
      ('b', 'vision.shots', 'not json'),
      ('a', 'vision.analyse', NULL);
  `);
  db.close();
  return path;
}

const manifest = {
  set: 'test-set',
  clips: [
    {
      file: 'a.mp4',
      fps: 30,
      seconds: 30,
      cuts: [
        { at: 100 / 30, kind: 'cut', seconds: 0 },
        { at: 15, kind: 'dissolve', seconds: 1 },
      ],
    },
    { file: 'b.mov', fps: 30, seconds: 30, cuts: [{ at: 10, kind: 'cut', seconds: 0 }] },
    { file: 'gone.mp4', fps: 25, seconds: 10, cuts: [{ at: 5, kind: 'cut', seconds: 0 }] },
  ],
};

describe('storedPredictions', () => {
  it('reads each asset’s boundaries on its clip’s grid, with spans and the detector from the stage output', () => {
    const rates: Record<string, number> = { 'a.mp4': 30, 'b.mov': 30 };
    const predictions = storedPredictions(library(), (file) => rates[file]);
    expect(predictions.clips).toEqual([
      {
        file: 'a.mp4',
        detector: 'model',
        boundaries: [{ frame: 100 }, { frame: 466, kind: 'dissolve', span: { from: 450, to: 480 } }],
      },
      { file: 'b.mov', boundaries: [{ frame: 300 }] },
    ]);
  });
});

describe('eval:shots', () => {
  it('scores stored libraries and detector runs, and writes the report and its JSON', () => {
    const manifestPath = join(dir, 'manifest.json');
    writeFileSync(manifestPath, JSON.stringify(manifest));
    const runPath = join(dir, 'run.json');
    writeFileSync(
      runPath,
      JSON.stringify({
        detector: 'transnetv2',
        clips: [{ file: 'a.mp4', boundaries: [{ frame: 101 }], timings: { model: 12 } }],
      }),
    );
    const out = join(dir, 'report.md');
    const { reports } = evalShots([
      '--manifest',
      manifestPath,
      '--library',
      library(),
      '--predictions',
      runPath,
      '--out',
      out,
    ]);
    expect(reports.map((r) => r.scores.counts)).toEqual([
      {
        cuts: 3,
        cutsFound: 2,
        cutsExact: 2,
        dissolves: 1,
        dissolvesFound: 1,
        fades: 0,
        fadesFound: 0,
        predicted: 3,
        falseBoundaries: 0,
      },
      {
        cuts: 3,
        cutsFound: 1,
        cutsExact: 0,
        dissolves: 1,
        dissolvesFound: 0,
        fades: 0,
        fadesFound: 0,
        predicted: 1,
        falseBoundaries: 0,
      },
    ]);
    expect(reports[1]?.missingClips).toEqual(['b.mov', 'gone.mp4']);
    expect(readFileSync(out, 'utf8')).toContain('## transnetv2');
    expect(readFileSync(out, 'utf8')).toContain('Time (ms, summed over clips): model 12.');
    expect(JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8'))).toMatchObject({ set: 'test-set' });
    expect(readFileSync(out, 'utf8')).toContain('Decided by: model 1 clips.');
  });

  it('refuses a run named after one detector whose clips another decided (IX2-S7)', async () => {
    const manifestPath = join(dir, 'manifest.json');
    writeFileSync(manifestPath, JSON.stringify(manifest));
    const run = (detector: string, deciders: string[]) => {
      const path = join(dir, `${detector}.json`);
      const clips = deciders.map((decider, i) => ({
        file: i === 0 ? 'a.mp4' : 'b.mov',
        detector: decider,
        boundaries: [],
      }));
      writeFileSync(path, JSON.stringify({ detector, clips }));
      return path;
    };
    const fellBack = run('transnetv2', ['model', 'scdet']);
    expect(() => evalShots(['--manifest', manifestPath, '--predictions', fellBack])).toThrow(
      'transnetv2: another detector decided b.mov (scdet); not scored as transnetv2',
    );
    expect(await main(['eval', '--manifest', manifestPath, '--predictions', fellBack])).toBe(1);
    expect(() =>
      evalShots(['--manifest', manifestPath, '--predictions', run('scdet+confirm', ['model'])]),
    ).toThrow(/a\.mp4 \(model\)/);
    const { reports } = evalShots([
      '--manifest',
      manifestPath,
      '--predictions',
      run('transnetv2@15fps', ['model']),
    ]);
    expect(reports[0]?.decidedBy).toEqual({ model: 1 });
  });

  it('refuses a run without inputs, a bad tolerance and an unknown command', async () => {
    const manifestPath = join(dir, 'manifest.json');
    writeFileSync(manifestPath, JSON.stringify(manifest));
    expect(() => evalShots(['--manifest', manifestPath])).toThrow(/at least one --library/);
    const db = library();
    expect(() => evalShots(['--manifest', manifestPath, '--library', db, '--tolerance', '-1'])).toThrow(
      /--tolerance/,
    );
    expect(() => evalShots([])).toThrow(/--manifest is required/);
    expect(await main(['nope'])).toBe(1);
    expect(await main(['eval', '--manifest', manifestPath, '--library', db])).toBe(0);
  });
});
