// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import {
  HOUR_MS,
  scoreRenderGrowth,
  scoreTimeGrowth,
  WARMUP_MS,
  type SoakRssSample,
} from '../../src/soak/score';

const EIGHT_HOURS = 8 * HOUR_MS;
const MINUTE = 60 * 1000;

function at(ms: number, rss: number, name = 'main'): SoakRssSample {
  return { at: ms, processes: [{ name, rssBytes: rss }] };
}

function atProcesses(ms: number, rss: Readonly<Record<string, number>>): SoakRssSample {
  return {
    at: ms,
    processes: Object.entries(rss).map(([name, rssBytes]) => ({ name, rssBytes })),
  };
}

function renderSample(index: number, rss: number, name = 'main'): SoakRssSample {
  return { at: index, renderIndex: index, processes: [{ name, rssBytes: rss }] };
}

function series(earlyRss: number, lateRss: number, name = 'main'): SoakRssSample[] {
  return [at(WARMUP_MS + MINUTE, earlyRss, name), at(EIGHT_HOURS - MINUTE, lateRss, name)];
}

describe('scoreTimeGrowth', () => {
  it('passes at 9.9% growth', () => {
    const score = scoreTimeGrowth(series(1000, 1099), { durationMs: EIGHT_HOURS });
    expect(score.verdict).toBe('pass');
    expect(score.reasons).toEqual([]);
    expect(score.growth).toEqual([{ process: 'main', early: 1000, late: 1099, ratio: 0.099 }]);
  });

  it('fails at 10.1% growth and names the process', () => {
    const score = scoreTimeGrowth(series(1000, 1101), { durationMs: EIGHT_HOURS });
    expect(score.verdict).toBe('fail');
    expect(score.reasons).toEqual(['growth:main']);
    expect(score.growth[0]?.ratio).toBeCloseTo(0.101, 10);
  });

  it('passes at exactly 10%', () => {
    const score = scoreTimeGrowth(series(1000, 1100), { durationMs: EIGHT_HOURS });
    expect(score.verdict).toBe('pass');
    expect(score.growth[0]?.ratio).toBeCloseTo(0.1, 10);
  });

  it('excludes warm-up, including a huge sample at 5 min', () => {
    const score = scoreTimeGrowth(
      [
        at(5 * MINUTE, 1_000_000_000),
        at(WARMUP_MS, 1000),
        at(WARMUP_MS + HOUR_MS, 9_000),
        at(EIGHT_HOURS - HOUR_MS, 1000),
      ],
      { durationMs: EIGHT_HOURS },
    );
    expect(score.verdict).toBe('pass');
    expect(score.growth).toEqual([{ process: 'main', early: 1000, late: 1000, ratio: 0 }]);
  });

  it('fails only the process whose growth is over 10%', () => {
    const earlyAt = WARMUP_MS + MINUTE;
    const lateAt = EIGHT_HOURS - MINUTE;
    const score = scoreTimeGrowth(
      [
        atProcesses(earlyAt, { main: 1000, renderer: 1000 }),
        atProcesses(lateAt, { main: 1099, renderer: 1101 }),
      ],
      { durationMs: EIGHT_HOURS },
    );
    expect(score.verdict).toBe('fail');
    expect(score.reasons).toEqual(['growth:renderer']);
    expect(score.growth.map((row) => row.process)).toEqual(['main', 'renderer']);
  });

  it('is missing when a window has no samples, and does not invent 0% growth', () => {
    const earlyOnly = scoreTimeGrowth([at(WARMUP_MS + MINUTE, 1000)], { durationMs: EIGHT_HOURS });
    expect(earlyOnly.verdict).toBe('missing');
    expect(earlyOnly.growth).toEqual([]);
    expect(earlyOnly.reasons).toEqual(['missing-samples:main']);
    expect(earlyOnly.growth.some((row) => row.ratio === 0)).toBe(false);

    const noSamples = scoreTimeGrowth([], { durationMs: EIGHT_HOURS });
    expect(noSamples.verdict).toBe('missing');
    expect(noSamples.growth).toEqual([]);
    expect(noSamples.reasons).toEqual(['missing-samples']);
  });

  it('fails with a named reason when the early median is 0, and the ratio is not Infinity', () => {
    const score = scoreTimeGrowth(series(0, 500), { durationMs: EIGHT_HOURS });
    expect(score.verdict).toBe('fail');
    expect(score.reasons).toEqual(['zero-early-rss:main']);
    expect(score.growth).toEqual([{ process: 'main', early: 0, late: 500, ratio: null }]);
    expect(score.growth[0]?.ratio).not.toBe(Infinity);
  });
});

describe('scoreRenderGrowth', () => {
  function fifty(lateRss: number): SoakRssSample[] {
    const samples: SoakRssSample[] = [];
    for (let index = 1; index <= 50; index += 1) {
      const rss = index <= 5 ? 9_000_000 : index <= 15 ? 1000 : index < 41 ? 50_000 : lateRss;
      samples.push(renderSample(index, rss));
    }
    samples.push({ at: 0, processes: [{ name: 'main', rssBytes: 8_000_000 }] });
    return samples;
  }

  it('compares renders 41–50 with renders 6–15 and passes at 9.9%', () => {
    const score = scoreRenderGrowth(fifty(1099));
    expect(score.verdict).toBe('pass');
    expect(score.growth).toEqual([{ process: 'main', early: 1000, late: 1099, ratio: 0.099 }]);
  });

  it('fails renders 41–50 against 6–15 at 10.1% and names the process', () => {
    const score = scoreRenderGrowth(fifty(1101));
    expect(score.verdict).toBe('fail');
    expect(score.reasons).toEqual(['growth:main']);
    expect(score.growth[0]?.ratio).toBeCloseTo(0.101, 10);
  });

  it('is missing when the late renders were not sampled', () => {
    const samples = Array.from({ length: 20 }, (_, index) => renderSample(index + 1, 1000));
    const score = scoreRenderGrowth(samples);
    expect(score.verdict).toBe('missing');
    expect(score.growth).toEqual([]);
    expect(score.reasons).toEqual(['missing-samples:main']);
  });
});
