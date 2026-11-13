// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import { matchCuts } from '../src/match';

describe('matchCuts', () => {
  it('matches a cut that is off by 2 and rejects one that is off by 3', () => {
    expect(matchCuts([100], [102]).matches).toEqual([{ truth: 100, predicted: 102, distance: 2 }]);
    expect(matchCuts([100], [98]).matches).toEqual([{ truth: 100, predicted: 98, distance: 2 }]);
    const missed = matchCuts([100], [103]);
    expect(missed.matches).toEqual([]);
    expect(missed.missedTruths).toEqual([100]);
    expect(missed.unmatchedPredictions).toEqual([103]);
  });

  it('pairs one-to-one, keeping the closer prediction', () => {
    const result = matchCuts([10], [10, 12]);
    expect(result.matches).toEqual([{ truth: 10, predicted: 10, distance: 0 }]);
    expect(result.unmatchedPredictions).toEqual([12]);
  });

  it('breaks a distance tie by the true frame, then the predicted frame', () => {
    const byTruth = matchCuts([10, 14], [12]);
    expect(byTruth.matches).toEqual([{ truth: 10, predicted: 12, distance: 2 }]);
    expect(byTruth.missedTruths).toEqual([14]);

    const byPrediction = matchCuts([10], [8, 12]);
    expect(byPrediction.matches).toEqual([{ truth: 10, predicted: 8, distance: 2 }]);
    expect(byPrediction.unmatchedPredictions).toEqual([12]);
  });

  it('reports every extra prediction and every missed truth', () => {
    const result = matchCuts([10, 40], [10, 30, 80]);
    expect(result.matches).toEqual([{ truth: 10, predicted: 10, distance: 0 }]);
    expect(result.missedTruths).toEqual([40]);
    expect(result.unmatchedPredictions).toEqual([30, 80]);
  });

  it('matches nothing when either side has no cuts', () => {
    expect(matchCuts([], []).matches).toEqual([]);
    expect(matchCuts([], [4]).unmatchedPredictions).toEqual([4]);
    expect(matchCuts([4], []).missedTruths).toEqual([4]);
  });
});
