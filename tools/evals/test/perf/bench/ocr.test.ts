// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Whether a bench read on-screen text: per run from the library copy and the process samples, then together. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { benchOcr, fullOcr, ocrLine, readTextShots, withoutOcr } from '../../../src/perf/bench/ocr';
import { summariseRun } from '../../../src/perf/bench/run-summary';
import { processSamples, runRecord } from './fixtures';

const HELPER = {
  mode: 'helper' as const,
  helper: { path: '/repo/dist/taalcut-mac-helper', version: '1.0.0', sha256: '7ae2d153a09cf3bb8e08' },
  reason: null,
};

describe('readTextShots', () => {
  let dir = '';
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  function library(sql: string): string {
    dir = mkdtempSync(join(tmpdir(), 'taalcut-ocr-'));
    const path = join(dir, 'index-library.sqlite');
    const db = new DatabaseSync(path);
    db.exec(sql);
    db.close();
    return path;
  }

  it('counts shots and the ones with on-screen text', () => {
    const path = library(`
      CREATE TABLE shots (id TEXT PRIMARY KEY, on_screen_text TEXT);
      INSERT INTO shots VALUES ('a', 'MARKET DAY'), ('b', NULL), ('c', ''), ('d', '  '), ('e', 'नमस्ते');`);
    expect(readTextShots(path)).toEqual({ shots: 5, textShots: 2 });
  });

  it('is null for a library without the column, and zero for one without shots', () => {
    expect(readTextShots(library('CREATE TABLE shots (id TEXT PRIMARY KEY);'))).toBeNull();
    rmSync(dir, { recursive: true, force: true });
    expect(readTextShots(library('CREATE TABLE shots (id TEXT, on_screen_text TEXT);'))).toEqual({
      shots: 0,
      textShots: 0,
    });
  });
});

describe('a run and a bench with and without the helper', () => {
  it('counts the samples the helper was alive in', () => {
    const run = summariseRun({
      run: 1,
      record: runRecord(),
      processes: processSamples(5, 1.5, true),
      finish: null,
      textShots: { shots: 68, textShots: 21 },
      helperExpected: true,
    });
    expect(run.ocr).toEqual({ helperSamples: 5, shots: 68, textShots: 21, counters: null });
    expect(run.noise.reasons.join()).not.toContain('mac helper');
    expect(run.memory.jobs?.peakByCommand['taalcut-mac-helper']).toBe(60_000 * 1024);
  });

  it('has no helper count without process samples', () => {
    const run = summariseRun({
      run: 1,
      record: runRecord(),
      processes: [],
      finish: null,
      textShots: null,
      helperExpected: true,
    });
    expect(run.ocr).toEqual({ helperSamples: null, shots: null, textShots: null, counters: null });
    expect(run.noise.reasons.join()).not.toContain('mac helper');
  });

  it('says with or without OCR, and which benches budgets may come from', () => {
    const ran = { helperSamples: 300, shots: 68, textShots: 21, counters: null };
    const runs = [ran, { helperSamples: 290, shots: 68, textShots: 22, counters: null }];
    const on = benchOcr(HELPER, runs);
    expect(on).toMatchObject({ helperRuns: 2, sampledRuns: 2, textShots: { median: 21.5 } });
    expect([withoutOcr(on), fullOcr(on)]).toEqual([false, true]);
    expect(ocrLine(on)).toBe(
      'On-screen text (OCR): mac helper 1.0.0 (/repo/dist/taalcut-mac-helper, sha256 7ae2d153a09c); ' +
        'the helper ran in 2 of 2 runs; ' +
        'shots with on-screen text: 21.5 of 68 (median).',
    );

    const partly = benchOcr(HELPER, [ran, { helperSamples: 0, shots: 68, textShots: 0, counters: null }]);
    expect([withoutOcr(partly), fullOcr(partly)]).toEqual([false, false]);
    expect(ocrLine(partly)).toContain('Runs without it are flagged noisy.');

    const off = benchOcr({ mode: 'off', helper: null, reason: 'run with --no-mac-helper' }, runs);
    expect([withoutOcr(off), fullOcr(off)]).toEqual([true, false]);
    expect(ocrLine(off)).toMatch(/^\*\*Without OCR\*\* \(run with --no-mac-helper\)/);

    const older = benchOcr(null, [{ helperSamples: 0, shots: 68, textShots: 0, counters: null }]);
    expect([withoutOcr(older), fullOcr(older)]).toEqual([true, false]);
    expect(ocrLine(older)).toContain('not checked when this bench ran');
    expect(withoutOcr(undefined)).toBe(false);
  });

  it("adds the ocr lane's counters as medians once the jobs report them", () => {
    const counted = (requests: number, perFrame: number) => ({
      helperSamples: 300,
      shots: 68,
      textShots: 17,
      counters: { requests, frames: requests * 10, engineMsPerFrame: perFrame },
    });
    const ocr = benchOcr(HELPER, [counted(100, 40), counted(120, 44), counted(110, 41)]);
    expect(ocr.requests).toEqual({ median: 110, min: 100, max: 120, n: 3 });
    expect(ocrLine(ocr)).toContain(
      'shots with on-screen text: 17 of 68 (median); OCR 110 requests, 1100 frames, 41 Vision ms per frame (medians).',
    );
  });
});
