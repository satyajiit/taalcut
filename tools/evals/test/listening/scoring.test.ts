// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-I3: the comparisons listen-parity and listen-breakdown-hits make, on hand-made cases (the suites themselves
 * run on the parity fixtures with `eval`): event matching, offsets, the critique's tolerances and stand-in tagger,
 * a template's agreement with upstream, and the summaries.
 */
import { musicWindows } from '@taalcut/audio';
import type { Template } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { agreement, filmTruth } from '../../src/listen-breakdown-hits/suite';
import { shareTagger, tolerance } from '../../src/listen-parity/critique';
import { matchEvents, offsetsAgree } from '../../src/listen-parity/dsp';
import { maxOf, quantile, share } from '../../src/listen-parity/stats';

describe('listen-parity comparisons', () => {
  it('matches events one to one, same shape, nearest first, within the tolerance', () => {
    const ours = [
      { t: 1.0, shape: 'hit' as const },
      { t: 1.004, shape: 'hit' as const },
      { t: 2.0, shape: 'swell' as const },
      { t: 3.0, shape: 'hit' as const },
    ];
    const theirs = [
      { t: 1.003, shape: 'hit' as const },
      { t: 2.001, shape: 'hit' as const },
      { t: 2.002, shape: 'swell' as const },
    ];
    expect(matchEvents(ours, theirs, 0.005)).toEqual({ found: 2, extra: 2 });
  });

  it('agrees on offsets within 1 ms, and on a cut with none on both sides', () => {
    expect(offsetsAgree(20.4, 21)).toBe(true);
    expect(offsetsAgree(20, 21.5)).toBe(false);
    expect(offsetsAgree(null, null)).toBe(true);
    expect(offsetsAgree(null, 0)).toBe(false);
  });

  it('holds the critique to the plan’s tolerance per unit', () => {
    expect([
      tolerance('lufsI'),
      tolerance('firstSoundS'),
      tolerance('musicFrac'),
      tolerance('pReal'),
    ]).toEqual([0.1, 0.005, 0.01, 0.01]);
    expect([tolerance('brightnessHz'), tolerance('onsetRate'), tolerance('correlation')]).toEqual([
      1, 0.01, 0.01,
    ]);
  });

  it('answers upstream’s music and speech shares through audio’s own window pass', async () => {
    const mono = new Float32Array(48_000 * 21);
    const windows = await musicWindows(shareTagger(0.6, 0.2), mono);
    expect(windows.ok).toBe(true);
    if (!windows.ok) return;
    expect(windows.value.map((w) => w.t)).toEqual([0, 5, 10, 15, 20]);
    expect(windows.value.filter((w) => w.music >= 0.3)).toHaveLength(3);
    expect(windows.value.filter((w) => w.speech >= 0.5)).toHaveLength(1);
  });

  it('summarises to null when there is nothing, and lets a missing number fail', () => {
    expect([share(1, 4), share(0, 0), maxOf([]), quantile([], 1)]).toEqual([0.25, null, null, null]);
    expect(maxOf([0.1, Number.NaN, 0.2])).toBeNaN();
    const values = Array.from({ length: 100 }, (_, i) => i / 100);
    expect([quantile(values, 1), quantile(values, 0.99), quantile(values, 0.5)]).toEqual([0.99, 0.99, 0.5]);
  });
});

describe('listen-breakdown-hits agreement', () => {
  it('reads upstream’s status for each of a film’s cuts', () => {
    const truth = filmTruth('film-00');
    expect(truth.cuts.length).toBeGreaterThanOrEqual(30);
    expect(truth.statuses).toHaveLength(truth.cuts.length);
    expect(new Set(truth.statuses)).toEqual(new Set(['ok', 'near', 'swell', 'peak', 'off', 'none']));
  });

  it('counts a cut whose slot starts at the film’s cut with upstream’s status; a missed cut counts against', () => {
    const truth = { id: 'f', cuts: [30, 60, 90], statuses: ['ok', 'near', 'none'] as const };
    const slot = (frame: number) => ({ start: { value: frame, rate: { num: 30, den: 1 } } });
    const template = {
      slots: [slot(0), slot(30), slot(60)],
      audio: {
        listening: {
          cutSync: {
            items: [
              { cutIndex: 1, status: 'ok' },
              { cutIndex: 2, status: 'off' },
            ],
          },
        },
      },
    } as unknown as Template;
    expect(agreement(truth, template)).toEqual({ agree: 1 / 3, same: 1, missed: 1 });
  });
});
