// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runSuiteCli, type SuiteCommands, type SuiteReport } from '../src/suite-cli';

interface Calls {
  scored: [string, string][];
  reports: string[];
  predictions: string[];
  fixtures: string[];
}

function suite(pass: boolean, claimed = false): { commands: SuiteCommands<SuiteReport, string>; calls: Calls } {
  const calls: Calls = { scored: [], reports: [], predictions: [], fixtures: [] };
  const commands: SuiteCommands<SuiteReport, string> = {
    suite: 'demo',
    score: (labelsDir, predictionsDir) => {
      calls.scored.push([labelsDir, predictionsDir]);
      return { claimed, gate: { pass, detail: 'demo 0.5 (need 1)' } };
    },
    writeReport: (_report, markdownPath) => calls.reports.push(markdownPath),
    predict: async () => ['a', 'b'],
    writePredictions: (_predictions, outDir) => calls.predictions.push(outDir),
    writeFixtures: (outDir) => {
      calls.fixtures.push(outDir);
      return { labels: resolve(outDir, 'labels') };
    },
  };
  return { commands, calls };
}

afterEach(() => vi.restoreAllMocks());

describe('suite CLI', () => {
  it('exits 1 when the suite misses its bar, so the PR job fails, and still writes the report', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { commands, calls } = suite(false);
    const code = await runSuiteCli(commands, ['eval', '--', '--labels', 'l', '--predictions', 'p', '--out', 'r.md']);
    expect(code).toBe(1);
    expect(calls.scored).toEqual([[resolve('l'), resolve('p')]]);
    expect(calls.reports).toEqual([resolve('r.md')]);
    expect(log).toHaveBeenCalledWith('demo 0.5 (need 1). fail. Synthetic: not a gate result.');
  });

  it('exits 0 on a pass and drops the synthetic marker only for claimed reports', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const code = await runSuiteCli(suite(true, true).commands, [
      'eval',
      '--labels',
      'l',
      '--predictions',
      'p',
      '--out',
      'r.md',
    ]);
    expect(code).toBe(0);
    expect(log).toHaveBeenCalledWith('demo 0.5 (need 1). pass.');
  });

  it('awaits predict and writes fixtures', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { commands, calls } = suite(true);
    expect(await runSuiteCli(commands, ['predict', '--labels', 'l', '--out', 'o'])).toBe(0);
    expect(calls.predictions).toEqual([resolve('o')]);
    expect(await runSuiteCli(commands, ['fixtures', '--out', 'f'])).toBe(0);
    expect(calls.fixtures).toEqual([resolve('f')]);
  });

  it('exits 1 with the usage on a missing flag, an unknown flag or an unknown command', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { commands, calls } = suite(true);
    expect(await runSuiteCli(commands, ['eval', '--labels', 'l'])).toBe(1);
    expect(await runSuiteCli(commands, ['predict', '--labels', 'l', '--out', 'o', '--bogus', 'x'])).toBe(1);
    expect(await runSuiteCli(commands, ['score'])).toBe(1);
    expect(calls.scored).toEqual([]);
    expect(String(error.mock.calls[0]?.[0])).toContain('eval:demo --labels <dir> --predictions <dir> --out <report.md>');
  });
});
