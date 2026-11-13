// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import { scoreClip, shotScores } from '../../src/shots/score';
import { clipTruth, type ClipTruth } from '../../src/shots/truth';

const truth: ClipTruth = {
  file: 'a.mp4',
  fps: 30,
  frames: 900,
  cuts: [100, 300, 600],
  dissolves: [{ from: 450, to: 480 }],
  fades: [],
};

describe('clipTruth', () => {
  it('puts cuts on the grid and dissolves as their blended frames', () => {
    const clip = clipTruth({
      file: 'b.mov',
      fps: 30,
      seconds: 30,
      cuts: [
        { at: 39.45 / 2, kind: 'cut', seconds: 0 },
        { at: 7.5, kind: 'dissolve', seconds: 1 },
        { at: 4.4, kind: 'cut', seconds: 0 },
        { at: 20, kind: 'fade', seconds: 1.5 },
      ],
    });
    expect(clip).toEqual({
      file: 'b.mov',
      fps: 30,
      frames: 900,
      cuts: [132, 592],
      dissolves: [{ from: 225, to: 255 }],
      fades: [{ from: 600, to: 645 }],
    });
  });
});

describe('fades through black (IX3-D3)', () => {
  const faded: ClipTruth = { ...truth, cuts: [100], dissolves: [], fades: [{ from: 600, to: 645 }] };

  it('finds a fade by one boundary inside it, whatever kind the detector gave it', () => {
    const fade = scoreClip(faded, [
      { frame: 100 },
      { frame: 623, kind: 'fade', span: { from: 600, to: 645 } },
    ]);
    expect(fade).toMatchObject({ fades: 1, fadesFound: 1, falseBoundaries: 0, missedFades: [] });
    expect(scoreClip(faded, [{ frame: 100 }, { frame: 612, kind: 'cut' }]).fadesFound).toBe(1);
  });

  it('counts the second end of a fade a detector marked twice as false', () => {
    const twice = scoreClip(faded, [{ frame: 100 }, { frame: 612 }, { frame: 634 }]);
    expect(twice).toMatchObject({ fadesFound: 1, falseBoundaries: 1, extra: [634] });
  });

  it('misses a fade nothing marked, and scores fade recall and every boundary over clips', () => {
    const missed = scoreClip(faded, [{ frame: 100 }]);
    expect(missed.missedFades).toEqual([{ from: 600, to: 645 }]);
    const found = scoreClip({ ...faded, file: 'c.mp4' }, [{ frame: 100 }, { frame: 623 }]);
    const scores = shotScores([missed, found]);
    expect(scores.counts).toMatchObject({ fades: 2, fadesFound: 1 });
    expect(scores.fadeRecall).toBe(0.5);
    expect(scores.all.recall).toBeCloseTo(3 / 4);
    expect(scores.cut.f1).toBe(1);
  });

  it('lets dissolves claim their boundaries before fades', () => {
    const both: ClipTruth = {
      ...truth,
      cuts: [],
      dissolves: [{ from: 600, to: 620 }],
      fades: [{ from: 610, to: 645 }],
    };
    const score = scoreClip(both, [{ frame: 612 }]);
    expect(score).toMatchObject({ dissolvesFound: 1, fadesFound: 0 });
  });
});

describe('scoreClip', () => {
  it('finds every cut within one frame and the dissolve by a boundary inside it', () => {
    const score = scoreClip(truth, [{ frame: 101 }, { frame: 300 }, { frame: 599 }, { frame: 466 }]);
    expect(score).toMatchObject({
      cutsFound: 3,
      cutsExact: 1,
      dissolvesFound: 1,
      falseBoundaries: 0,
      missedCuts: [],
      missedDissolves: [],
    });
  });

  it('misses a cut two frames off and counts that boundary as false', () => {
    const score = scoreClip(truth, [{ frame: 102 }, { frame: 300 }, { frame: 600 }]);
    expect(score.missedCuts).toEqual([100]);
    expect(score.extra).toEqual([102]);
    expect(score.missedDissolves).toEqual([{ from: 450, to: 480 }]);
  });

  it('matches a dissolve by its span when the boundary sits just outside it', () => {
    const span = scoreClip(truth, [{ frame: 485, kind: 'dissolve', span: { from: 470, to: 490 } }]);
    expect(span.dissolvesFound).toBe(1);
    const point = scoreClip(truth, [{ frame: 485 }]);
    expect(point.dissolvesFound).toBe(0);
    expect(point.falseBoundaries).toBe(1);
    expect(scoreClip(truth, [{ frame: 481 }]).dissolvesFound).toBe(1);
  });

  it('takes one boundary per dissolve: a second one inside it is false', () => {
    const score = scoreClip(truth, [{ frame: 452 }, { frame: 465 }]);
    expect(score.dissolvesFound).toBe(1);
    expect(score.extra).toEqual([452]);
  });

  it('gives cuts first claim on a boundary next to a dissolve', () => {
    const near: ClipTruth = { ...truth, cuts: [449], dissolves: [{ from: 450, to: 480 }] };
    const score = scoreClip(near, [{ frame: 450 }]);
    expect(score.cutsFound).toBe(1);
    expect(score.dissolvesFound).toBe(0);
  });
});

describe('shotScores', () => {
  it('sums counts over clips before the ratios', () => {
    const perfect = scoreClip(truth, [{ frame: 100 }, { frame: 300 }, { frame: 600 }, { frame: 460 }]);
    const half = scoreClip({ ...truth, file: 'b.mp4' }, [{ frame: 100 }, { frame: 700 }]);
    const scores = shotScores([perfect, half]);
    expect(scores.counts).toMatchObject({ cuts: 6, cutsFound: 4, dissolves: 2, dissolvesFound: 1 });
    expect(scores.cut.precision).toBeCloseTo(4 / 5);
    expect(scores.cut.recall).toBeCloseTo(4 / 6);
    expect(scores.cut.f1).toBeCloseTo((2 * 0.8 * (4 / 6)) / (0.8 + 4 / 6));
    expect(scores.dissolveRecall).toBe(0.5);
    expect(scores.all.recall).toBeCloseTo(5 / 8);
  });

  it('scores nothing labelled and nothing found as perfect, and nothing found as zero', () => {
    const empty = scoreClip({ ...truth, cuts: [], dissolves: [] }, []);
    expect(shotScores([empty]).fadeRecall).toBe(1);
    expect(shotScores([empty]).cut).toEqual({ precision: 1, recall: 1, f1: 1 });
    const blind = scoreClip(truth, []);
    expect(shotScores([blind]).cut.f1).toBe(0);
  });
});
