// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import { GATE3_REEL_SHARE, scoreAll } from '../src/metric';
import { type GoldenReel, type PredictionReel } from '../src/schema';

function reel(id: string, cuts: number[], synthetic: boolean): GoldenReel {
  return {
    reelId: id,
    synthetic,
    note: synthetic ? 'Synthetic reel for the gate boundary.' : 'A labelled reel.',
    source: { label: id, durationFrames: 100 },
    frameRate: { numerator: 30, denominator: 1 },
    cuts,
    beats: [],
    slots: [],
    overlays: [],
    transitions: [],
    audio: { type: 'music' },
    languages: ['en'],
  };
}

function prediction(reelId: string, cuts: number[]): PredictionReel {
  return { reelId, cuts };
}

describe('gate criterion 3', () => {
  it('passes at exactly 85% of reels and fails just under', () => {
    const reels = Array.from({ length: 20 }, (_, index) => reel(`reel-${index}`, [10, 20], false));
    const atBar = reels.map((item, index) => ({
      reel: item,
      prediction: prediction(item.reelId, index < 17 ? [10, 20] : [10]),
    }));
    const justUnder = atBar.map((pair, index) =>
      index === 16 ? { ...pair, prediction: prediction(pair.reel.reelId, [10]) } : pair,
    );
    const pass = scoreAll(atBar);
    const fail = scoreAll(justUnder);
    expect(GATE3_REEL_SHARE).toBe(0.85);
    expect(pass.aggregate.reelsMeetingBarShare).toBe(0.85);
    expect(pass.gate3.pass).toBe(true);
    expect(pass.gate3.claimed).toBe(true);
    expect(fail.aggregate.reelsMeetingBarShare).toBe(0.8);
    expect(fail.gate3.pass).toBe(false);
  });

  it('does not claim the gate when any reel is synthetic', () => {
    const report = scoreAll([
      { reel: reel('made-up', [4], true), prediction: prediction('made-up', [4]) },
    ]);
    expect(report.synthetic).toBe(true);
    expect(report.gate3.pass).toBe(true);
    expect(report.gate3.claimed).toBe(false);
  });
});
