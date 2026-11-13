// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { loadLabelRows, loadPredictionRows } from '../src/labelled-files';
import { loadSearchPredictions } from '../src/search/schema';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function folder(files: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), 'taalcut-labelled-files-'));
  dirs.push(dir);
  for (const [name, value] of Object.entries(files)) writeFileSync(join(dir, name), JSON.stringify(value));
  return dir;
}

const rows = {
  what: 'test labels',
  schema: z.array(z.object({ caseId: z.string(), score: z.number() })),
  idOf: (row: { caseId: string }) => row.caseId,
};

describe('label and prediction folders', () => {
  it('reads every file in order and checks each with the schema', () => {
    const dir = folder({ 'a.json': [{ caseId: 'a', score: 1 }], 'b.json': [{ caseId: 'b', score: 2 }] });
    expect(loadLabelRows(dir, { ...rows, idName: 'caseId' }).map((row) => row.caseId)).toEqual(['a', 'b']);
    expect([...loadPredictionRows(dir, rows).keys()]).toEqual(['a', 'b']);
    expect(() =>
      loadLabelRows(folder({ 'a.json': [{ caseId: 'a' }] }), { ...rows, idName: 'caseId' }),
    ).toThrow(/a\.json/);
  });

  it('stops on an empty folder or one id twice, in the eval’s words', () => {
    const empty = folder({});
    expect(() => loadLabelRows(empty, { ...rows, idName: 'caseId' })).toThrow(
      `No test labels (*.json) in ${empty}`,
    );
    expect(() => loadPredictionRows(empty, rows)).toThrow(`No test labels (*.json) in ${empty}`);
    const twice = folder({ 'a.json': [{ caseId: 'a', score: 1 }], 'b.json': [{ caseId: 'a', score: 2 }] });
    expect(() => loadLabelRows(twice, { ...rows, idName: 'caseId' })).toThrow('Duplicate caseId a');
    expect(() => loadPredictionRows(twice, rows)).toThrow(
      `Duplicate prediction for a (${join(twice, 'b.json')})`,
    );
  });

  it('a search predictions file holds one prediction or a list', () => {
    const dir = folder({
      'one.json': { queryId: 'q1', results: [] },
      'two.json': [
        { queryId: 'q2', results: [] },
        { queryId: 'q3', results: [] },
      ],
    });
    expect([...loadSearchPredictions(dir).keys()].sort()).toEqual(['q1', 'q2', 'q3']);
  });
});
