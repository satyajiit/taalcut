// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { cpuSeconds, summariseProcesses } from '../../../src/perf/bench/processes';
import { readProcessSamples } from '../../../src/perf/bench/run-record';
import { ADDED_AT, processSamples, ps } from './fixtures';

describe('cpuSeconds', () => {
  it('reads every form ps prints', () => {
    expect(cpuSeconds('0:01.25')).toBeCloseTo(1.25);
    expect(cpuSeconds('46:36.51')).toBeCloseTo(46 * 60 + 36.51);
    expect(cpuSeconds('1098:22.18')).toBeCloseTo(1098 * 60 + 22.18);
    expect(cpuSeconds('2:03:04.50')).toBeCloseTo(2 * 3600 + 3 * 60 + 4.5);
    expect(cpuSeconds('1-02:03:04')).toBeCloseTo(86_400 + 2 * 3600 + 3 * 60 + 4);
  });

  it('throws on anything else', () => {
    expect(() => cpuSeconds('soon')).toThrow('not a ps CPU time');
  });
});

describe('summariseProcesses', () => {
  const window = { from: ADDED_AT, to: ADDED_AT + 10_000 };

  it('takes the peak of the jobs process and of its tree, per command', () => {
    const summary = summariseProcesses(processSamples(11), window);
    expect(summary.samples).toBe(11);
    expect(summary.jobs?.peakBytes).toBe(510_000 * 1024);
    expect(summary.jobs?.treePeakBytes).toBe((510_000 + 300_000) * 1024);
    expect(summary.jobs?.peakByCommand).toEqual({ self: 510_000 * 1024, ffmpeg: 300_000 * 1024 });
    expect(summary.agent?.treePeakBytes).toBe((150_000 + 2_000_000) * 1024);
  });

  it('sums processes of one command alive at once', () => {
    const [sample] = processSamples(1);
    if (!sample) throw new Error('fixture');
    const twice = { ...sample, rows: [...sample.rows, ps(12, 10, 100_000, '0:00.50', '/x/ffmpeg')] };
    expect(summariseProcesses([twice], window).jobs?.peakByCommand.ffmpeg).toBe(400_000 * 1024);
  });

  it("reads the security agents' CPU from cumulative time, per vendor", () => {
    const summary = summariseProcesses(processSamples(11, 1.5), window);
    expect(summary.security?.meanPercent).toBeCloseTo(160, 0);
    expect(summary.security?.byVendor.sophos?.meanPercent).toBeCloseTo(150, 0);
    expect(summary.security?.byVendor.fortinet?.meanPercent).toBeCloseTo(10, 0);
    expect(summary.security?.maxPercent).toBeGreaterThanOrEqual(159);
  });

  it("reads the media daemons' CPU apart from the security agents'", () => {
    const summary = summariseProcesses(processSamples(11, 1.5, false, 1.1), window);
    expect(summary.background?.meanPercent).toBeCloseTo(110, 0);
    expect(summary.background?.byGroup.mediaanalysisd?.meanPercent).toBeCloseTo(110, 0);
    expect(summary.security?.meanPercent).toBeCloseTo(160, 0);
    expect(summariseProcesses(processSamples(11), window).background).toBeNull();
  });

  it('counts a process only from its second sample, and not a reused pid', () => {
    const samples = processSamples(3);
    const [first, second, third] = samples;
    if (!first || !second || !third) throw new Error('fixture');
    // pid 90 is a different program in the last sample: its CPU time is not a difference.
    const renamed = {
      ...third,
      rows: third.rows.map((row) =>
        row.pid === 90 ? { ...row, command: 'SophosScanD', cpu: '99:00.00' } : row,
      ),
    };
    const summary = summariseProcesses([first, second, renamed], window);
    expect(summary.security?.byVendor.sophos?.maxPercent).toBeCloseTo(150, 0);
  });

  it('keeps to the indexing window', () => {
    const summary = summariseProcesses(processSamples(11), { from: ADDED_AT + 5000, to: ADDED_AT + 6000 });
    expect(summary.samples).toBe(2);
    expect(summary.load).toEqual({ mean: 9.5, max: 10 });
  });

  it('has no numbers without samples', () => {
    const summary = summariseProcesses([], window);
    expect(summary).toEqual({
      samples: 0,
      jobs: null,
      agent: null,
      security: null,
      load: null,
      background: null,
      commandSamples: {},
    });
  });
});

describe('summariseProcesses on a run with the shot model (IX2-S2, IX2-F7)', () => {
  // Three samples of bench ix2-shotproc-dev (2026-10-19), trimmed to the app's processes, paths shortened: before
  // the model started, and the run's peak with the model, main's child, beside the jobs process.
  const samples = readProcessSamples(fileURLToPath(new URL('./shot-model-processes.jsonl', import.meta.url)));
  const [before, peak, after] = samples;
  if (!before || !peak || !after) throw new Error('fixture: three samples');
  const window = { from: before.at, to: after.at };

  it("counts the model's memory in the jobs tree, per sample, under its utility name", () => {
    const jobs = summariseProcesses(samples, window).jobs;
    // The jobs process's own tree peaked at 4.63 GiB and the model held 0.26 GiB in that sample: 4.89 GiB.
    expect(jobs?.treePeakBytes).toBe(4_975_968_256 + 276_971_520);
    expect((jobs?.treePeakBytes ?? 0) / 1024 ** 3).toBeCloseTo(4.892, 3);
    expect(jobs?.peakByCommand['shot model']).toBe(282_247_168);
    expect(jobs?.peakByCommand.self).toBe(jobs?.peakBytes);
    expect(summariseProcesses([before], window).jobs?.peakByCommand['shot model']).toBeUndefined();
  });

  it('counts a helper once when it shows up under the jobs process too', () => {
    const model = peak.utilities['shot model'];
    const jobsPid = peak.utilities.jobs;
    if (model === undefined || jobsPid === undefined) throw new Error('fixture: jobs and shot model pids');
    const adopted = {
      ...peak,
      rows: peak.rows.map((row) => (row.pid === model ? { ...row, ppid: jobsPid } : row)),
    };
    expect(summariseProcesses([adopted], window).jobs?.treePeakBytes).toBe(4_975_968_256 + 276_971_520);
  });
});
