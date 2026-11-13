// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultBaselinePath, readBaseline } from '../../src/text-recall/baseline';
import { benchLibraries, evalTextRecall, main } from '../../src/text-recall/cli';
import { libraryName } from '../../src/text-recall/report';
import { MANIFEST, SHOTS, STAGES, writeLibrary } from './fixture';

let dir: string;
let manifest: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'text-recall-cli-'));
  manifest = join(dir, 'manifest.json');
  writeFileSync(manifest, JSON.stringify(MANIFEST));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

/** A bench label folder under `<dir>/runs/<label>` with one library per run. */
function bench(label: string, runs: readonly Parameters<typeof writeLibrary>[1][]): string {
  for (const [n, options] of runs.entries()) {
    const run = join(dir, 'runs', label, `run-${n + 1}`);
    mkdirSync(run, { recursive: true });
    writeLibrary(join(run, 'index-library.sqlite'), options);
  }
  mkdirSync(join(dir, 'runs', label, 'run-x'), { recursive: true });
  return join(dir, 'runs', label);
}

const ENV = {};

describe('eval:text-recall', () => {
  it('reads every run of a bench label, in run order, and names each run by its label', () => {
    bench('dev', [{}, {}]);
    expect(benchLibraries('dev', dir).map(libraryName)).toEqual(['dev/run-1', 'dev/run-2']);
    expect(() => benchLibraries('none', dir)).toThrow(/no bench at/);
    mkdirSync(join(dir, 'runs', 'empty'));
    expect(() => benchLibraries('empty', dir)).toThrow(/has no run-<n>\/index-library.sqlite/);
  });

  it('refuses a bench with a run that kept no library, naming it (IX3-F5, M7)', () => {
    bench('dev', [{}, {}]);
    mkdirSync(join(dir, 'runs', 'dev', 'run-3'));
    expect(benchLibraries('dev', dir).map(libraryName)).toEqual(['dev/run-1', 'dev/run-2', 'dev/run-3']);
    expect(() =>
      evalTextRecall(['--manifest', manifest, '--bench', 'dev', '--bench-root', dir], ENV),
    ).toThrow(/no library at .*run-3/);
  });

  it('scores each library against the floor when the set has no baseline, and says the runs agree', () => {
    bench('dev', [{}, {}]);
    const run = evalTextRecall(['--manifest', manifest, '--bench', 'dev', '--bench-root', dir], ENV);
    expect(run.report.baseline).toBeNull();
    expect(run.report.minFound).toBe(19);
    // 4 of 5 under the default floor of 19: fails.
    expect(run.report.pass).toBe(false);
    const passing = evalTextRecall(
      ['--manifest', manifest, '--bench', join(dir, 'runs', 'dev'), '--min-found', '4'],
      ENV,
    );
    expect(passing.report.pass).toBe(true);
    expect(passing.report.agree).toBe(true);
    expect(passing.markdown).toContain(
      'gate: pass dev/run-1: 4 of 5 read (floor 4), no baseline: floor only',
    );
    expect(passing.markdown).toContain('| b.mov | SKATE PARK | SKATE | PARK | “PHRK”, “SKATE” |');
    expect(passing.markdown).toContain('The libraries read the same words.');
  });

  it('writes a baseline the runs agree on, then gates a run that lost a word against it', () => {
    bench('base', [{}, {}]);
    const baseline = join(dir, 'baseline.json');
    const wrote = evalTextRecall(
      [
        '--manifest',
        manifest,
        '--bench',
        'base',
        '--bench-root',
        dir,
        '--min-found',
        '3',
        '--write-baseline',
        baseline,
      ],
      ENV,
    );
    expect(wrote.wrote).toBe(baseline);
    // The runs had to read 3 words; they read 4, which becomes the floor.
    expect(readBaseline(baseline)).toMatchObject({
      set: 'test-set',
      minFound: 4,
      total: 5,
      from: 'base/run-1, base/run-2',
    });
    const lost = SHOTS.map((shot) => (shot.file === 'b.mov' ? { ...shot, text: 'PHRK' } : shot));
    bench('head', [{ shots: lost }]);
    const run = evalTextRecall(
      ['--manifest', manifest, '--bench', 'head', '--bench-root', dir, '--baseline', baseline],
      ENV,
    );
    expect(run.report.pass).toBe(false);
    expect(run.markdown).toContain('gate: FAIL head/run-1: 3 of 5 read (floor 4), lost b.mov:SKATE');
  });

  it('writes no baseline from runs that disagree', () => {
    const lost = SHOTS.map((shot) => (shot.file === 'b.mov' ? { ...shot, text: 'PHRK' } : shot));
    bench('mixed', [{}, { shots: lost }]);
    const args = ['--manifest', manifest, '--bench', 'mixed', '--bench-root', dir, '--min-found', '3'];
    expect(() => evalTextRecall([...args, '--write-baseline', join(dir, 'b.json')], ENV)).toThrow(
      /read different words/,
    );
    expect(existsSync(join(dir, 'b.json'))).toBe(false);
    expect(evalTextRecall(args, ENV).report.agree).toBe(false);
  });

  it('fails closed: a refused library fails the run with its reasons, and main exits 1', () => {
    const failed = STAGES.map((row) =>
      row.file === 'a.mp4' && row.stage === 'vision.ocr'
        ? { ...row, state: 'failed', error: '{"code":"x.y"}' }
        : row,
    );
    const library = writeLibrary(join(dir, 'library.sqlite'), { stages: failed });
    const out = join(dir, 'out', 'report.md');
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    expect(main(['--', '--manifest', manifest, '--library', library, '--min-found', '1', '--out', out])).toBe(
      1,
    );
    expect(log).toHaveBeenCalledWith(`gate: FAIL ${library}: refused (vision.ocr failed on a.mp4: x.y)`);
    expect(readFileSync(out, 'utf8')).toContain(
      'Not scored, because its text is not the shipped pipeline’s:',
    );
    expect(JSON.parse(readFileSync(join(dir, 'out', 'report.json'), 'utf8'))).toMatchObject({ pass: false });
  });

  it('exits 0 when every library passes, and 1 on wrong input', () => {
    const library = writeLibrary(join(dir, 'library.sqlite'));
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(main(['--manifest', manifest, '--library', library, '--no-baseline', '--min-found', '4'])).toBe(0);
    expect(main(['--manifest', manifest])).toBe(1);
    expect(main(['--manifest', manifest, '--library', join(dir, 'gone.sqlite')])).toBe(1);
    expect(main(['--manifest', manifest, '--library', library, '--baseline', 'x', '--no-baseline'])).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('--baseline and --no-baseline together'));
  });

  it('defaults to the committed baseline of the manifest’s set, and ix-v1 has one', () => {
    expect(defaultBaselinePath('ix-v1')).toMatch(/tools\/evals\/text-recall\/baseline-ix-v1\.json$/);
    expect(readBaseline(defaultBaselinePath('ix-v1'))).toMatchObject({
      set: 'ix-v1',
      total: 24,
      // IX3-B3: the 20 words three runs of the IX3 default route read.
      minFound: 20,
    });
  });
});
