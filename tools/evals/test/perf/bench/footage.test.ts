// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { IX_V1, type Manifest } from '@taalcut/bench-footage';
import { describe, expect, it } from 'vitest';
import { BENCH_FOOTAGE_ENV, benchFootage, type EnsureSet } from '../../../src/perf/bench/footage';
import { benchLayout } from '../../../src/perf/bench/layout';

const layout = benchLayout('/bench', 'check');

/** Only what the provider reads of a manifest. */
const manifest = { set: 'ix-v1', clips: [{ file: 'a.mov' }], totalSeconds: 600 } as Manifest;

describe('benchFootage', () => {
  it('points the e2e at its own library cache for smoke, generating nothing', async () => {
    const calls: string[] = [];
    const footage = benchFootage({
      ensure: () => Promise.reject(new Error('no')),
      log: (l) => calls.push(l),
    });
    expect(await footage.prepare('smoke', layout, '/bench/stalls')).toEqual({
      TAALCUT_E2E_LIBRARY_CACHE: '/bench/footage/smoke',
    });
    expect(calls).toEqual([]);
  });

  it('makes ix-v1 under the bench root once and hands the e2e its folder', async () => {
    const asked: { name: string; dir: string; stallDir: string }[] = [];
    const lines: string[] = [];
    const ensure: EnsureSet = (set, dir, stallDir) => {
      asked.push({ name: set.name, dir, stallDir });
      return Promise.resolve({ manifest, generated: false });
    };
    const env = await benchFootage({ ensure, log: (line) => lines.push(line) }).prepare(
      'ix-v1',
      layout,
      '/bench/stalls',
    );
    expect(env).toEqual({ [BENCH_FOOTAGE_ENV]: '/bench/footage/ix-v1' });
    expect(asked).toEqual([{ name: IX_V1.name, dir: '/bench/footage/ix-v1', stallDir: '/bench/stalls' }]);
    expect(lines.join()).toMatch(/ix-v1: 1 files, 600 s, already there/);
  });

  it('fails the run when the set cannot be made', async () => {
    const footage = benchFootage({
      ensure: () => Promise.reject(new Error('ffmpeg ran past 20 min')),
      log: () => {},
    });
    await expect(footage.prepare('ix-v1', layout, '/bench/stalls')).rejects.toThrow(/ran past/);
  });
});
