// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import { overlapShare, shotsMatch } from '../src/shot-match';

const range = (startFrame: number, endFrame: number) => ({ startFrame, endFrame });

describe('shotsMatch', () => {
  it('matches at exactly half the shorter range and rejects just under', () => {
    const label = { asset: 'a.mp4', range: range(0, 10) };
    expect(overlapShare(range(0, 10), range(5, 15))).toBe(0.5);
    expect(shotsMatch(label, { asset: 'a.mp4', range: range(5, 15) })).toBe(true);
    expect(shotsMatch(label, { asset: 'a.mp4', range: range(6, 16) })).toBe(false);
  });

  it('matches any shot of the asset when the label has no range', () => {
    expect(shotsMatch({ asset: 'a.mp4' }, { asset: 'a.mp4', range: range(0, 1) })).toBe(true);
    expect(shotsMatch({ asset: 'a.mp4' }, { asset: 'b.mp4', range: range(0, 10) })).toBe(false);
  });

  it('does not match a prediction that omitted its range', () => {
    expect(shotsMatch({ asset: 'a.mp4', range: range(0, 10) }, { asset: 'a.mp4' })).toBe(false);
  });
});
