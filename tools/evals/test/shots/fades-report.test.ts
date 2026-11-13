// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX3-D3: `eval:shots` scores fades through black on their own recall line, from a detector run and from a stored
 * library (`kind: 'fade'` and its span in the shots stage's output), and a set without fades reports as before.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { evalShots } from '../../src/shots/cli';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'shots-fades-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const manifest = {
  set: 'fades-test',
  clips: [
    {
      file: 'f.mp4',
      fps: 30,
      seconds: 20,
      cuts: [
        { at: 4, kind: 'cut', seconds: 0 },
        { at: 9.5, kind: 'fade', seconds: 1.5 },
        { at: 15, kind: 'fade', seconds: 2 },
      ],
    },
  ],
};

function write(name: string, value: unknown): string {
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify(value));
  return path;
}

/** A stored library whose shots stage marked the first fade and missed the second. */
function library(): string {
  const path = join(dir, 'index-library.sqlite');
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE assets (id TEXT PRIMARY KEY, original_filename TEXT);
    CREATE TABLE shots (id TEXT, asset_id TEXT, index_in_asset INTEGER, start_value INTEGER,
      start_rate_num INTEGER, start_rate_den INTEGER);
    CREATE TABLE asset_index_stages (asset_id TEXT, stage TEXT, output TEXT);
    INSERT INTO assets VALUES ('f', 'f.mp4');
    INSERT INTO shots VALUES ('s1', 'f', 0, 0, 30, 1), ('s2', 'f', 1, 120, 30, 1), ('s3', 'f', 2, 307, 30, 1);
    INSERT INTO asset_index_stages VALUES
      ('f', 'vision.shots', '{"detector":"model","cuts":[{"frame":120},{"frame":307,"kind":"fade","span":{"from":285,"to":330}}]}');
  `);
  db.close();
  return path;
}

describe('eval:shots with fades through black', () => {
  it('gives fades their own recall line and columns, from a run and from a stored library', () => {
    const run = write('run.json', {
      detector: 'transnetv2-coreml',
      clips: [
        {
          file: 'f.mp4',
          detector: 'model',
          boundaries: [
            { frame: 120, kind: 'cut' },
            { frame: 307, kind: 'fade', span: { from: 285, to: 330 } },
            { frame: 480, kind: 'fade', span: { from: 450, to: 510 } },
          ],
        },
      ],
    });
    const out = join(dir, 'report.md');
    const { reports } = evalShots([
      '--manifest',
      write('manifest.json', manifest),
      '--predictions',
      run,
      '--library',
      library(),
      '--out',
      out,
    ]);
    const [stored, predicted] = [reports[0]!, reports[1]!];
    expect(predicted.scores.counts).toMatchObject({
      cuts: 1,
      cutsFound: 1,
      fades: 2,
      fadesFound: 2,
      falseBoundaries: 0,
    });
    expect(predicted.scores.fadeRecall).toBe(1);
    expect(stored.scores.counts).toMatchObject({ fades: 2, fadesFound: 1, falseBoundaries: 0 });
    expect(stored.clips[0]?.missedFades).toEqual([{ from: 450, to: 510 }]);
    const markdown = readFileSync(out, 'utf8');
    expect(markdown).toContain('Fades through black: **recall 1.000** (2/2)');
    expect(markdown).toContain('Fades through black: **recall 0.500** (1/2)');
    expect(markdown).toContain('| Clip | Cuts found | Dissolves found | Fades found | False |');
    expect(markdown).toContain('| f.mp4 | 1/1 | 0/0 | 1/2 | 0 |  |  | 450–510 |  |');
  });

  it('reports a set without fades as before: no fade line, no fade columns', () => {
    const plain = {
      set: 'plain',
      clips: [{ file: 'p.mp4', fps: 30, seconds: 10, cuts: [{ at: 2, kind: 'cut', seconds: 0 }] }],
    };
    const run = write('plain-run.json', {
      detector: 'scdet+confirm',
      clips: [{ file: 'p.mp4', boundaries: [{ frame: 60 }] }],
    });
    const { markdown } = evalShots(['--manifest', write('plain.json', plain), '--predictions', run]);
    expect(markdown).not.toContain('Fades');
    expect(markdown).toContain(
      '| Clip | Cuts found | Dissolves found | False | Missed cuts | Missed dissolves | False at |',
    );
  });
});
