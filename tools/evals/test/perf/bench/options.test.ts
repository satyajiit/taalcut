// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import { parseBenchArgs } from '../../../src/perf/bench/options';

const context = {
  env: { TAALCUT_BENCH_ROOT: '/bench' },
  cwd: '/repo',
  now: new Date('2026-10-17T09:05:00Z'),
};

describe('parseBenchArgs', () => {
  it('defaults to three recommended-tier runs on ix-v1, built once, with a dated label', () => {
    expect(parseBenchArgs([], context)).toEqual({
      command: 'run',
      tier: 'recommended',
      runs: 3,
      footage: 'ix-v1',
      label: 'recommended-ix-v1-20261017-0905',
      build: true,
      macHelper: true,
      benchRoot: '/bench',
      copyTo: null,
      stallDir: '/bench/runs/recommended-ix-v1-20261017-0905',
      minFreeGb: 50,
      keepCompiles: false,
    });
  });

  it('takes the stall folder from --stall-dir, else $TAALCUT_VT_STALL_DIR', () => {
    expect(parseBenchArgs(['--stall-dir', 'logs'], context)).toMatchObject({ stallDir: '/repo/logs' });
    const env = { ...context, env: { ...context.env, TAALCUT_VT_STALL_DIR: '/orch/logs/bench' } };
    expect(parseBenchArgs([], env)).toMatchObject({ stallDir: '/orch/logs/bench' });
  });

  it('reads every run flag, and paths relative to the caller', () => {
    const options = parseBenchArgs(
      [
        'run',
        '--tier',
        'high',
        '--runs',
        '1',
        '--footage',
        'smoke',
        '--label',
        'p3.compare',
        '--no-build',
        '--no-mac-helper',
      ].concat(['--bench-root', 'b', '--copy-to', '/orch/bench']),
      context,
    );
    expect(options).toMatchObject({
      tier: 'high',
      runs: 1,
      footage: 'smoke',
      label: 'p3.compare',
      build: false,
      macHelper: false,
      benchRoot: '/repo/b',
      copyTo: '/orch/bench',
    });
  });

  it('refuses a tier, footage, run count or label it does not know, with the usage', () => {
    expect(() => parseBenchArgs(['--tier', 'medium'], context)).toThrow(/--tier[\s\S]*Usage/);
    expect(() => parseBenchArgs(['--footage', 'hour'], context)).toThrow('--footage');
    expect(() => parseBenchArgs(['--runs', '0'], context)).toThrow('--runs');
    expect(() => parseBenchArgs(['--label', '../up'], context)).toThrow('label');
    expect(() => parseBenchArgs(['--frames', '3'], context)).toThrow('Usage');
  });

  it('reads analyse and compare', () => {
    expect(parseBenchArgs(['analyse', 'base'], context)).toEqual({
      command: 'analyse',
      label: 'base',
      benchRoot: '/bench',
      copyTo: null,
    });
    expect(parseBenchArgs(['compare', 'base', 'lanes', '--out', 'c.md'], context)).toEqual({
      command: 'compare',
      before: 'base',
      after: 'lanes',
      benchRoot: '/bench',
      out: '/repo/c.md',
    });
    expect(() => parseBenchArgs(['compare', 'base'], context)).toThrow('two summaries');
    expect(() => parseBenchArgs(['publish'], context)).toThrow('unknown command');
  });
});
