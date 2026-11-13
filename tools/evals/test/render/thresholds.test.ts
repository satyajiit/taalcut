// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import { driftFails } from '../../src/render/audio';
import { beatsMatch } from '../../src/render/check';
import { hamming, hashPasses } from '../../src/render/hash';

describe('render check boundaries', () => {
  it('treats Hamming distance 6 as a pass and 7 as a fail', () => {
    expect(hashPasses(6)).toBe(true);
    expect(hashPasses(7)).toBe(false);
    expect(hamming('0000000000000000', 'fc00000000000000')).toBe(6);
    expect(hashPasses(hamming('0000000000000000', 'fc00000000000000'))).toBe(true);
    expect(hamming('0000000000000000', 'fe00000000000000')).toBe(7);
    expect(hashPasses(hamming('0000000000000000', 'fe00000000000000'))).toBe(false);
  });

  it('treats 19 ms of drift as a pass and 20 ms as a fail', () => {
    expect(driftFails([0.019], [0])).toBe(false);
    expect(driftFails([0.02], [0])).toBe(true);
    expect(driftFails([1.019], [1])).toBe(false);
    expect(driftFails([1.02], [1])).toBe(true);
    expect(driftFails([0, 0.5], [0])).toBe(true);
    expect(driftFails([], [0])).toBe(true);
  });

  it('allows a cut 1 frame from a beat and rejects 2 frames', () => {
    expect(beatsMatch([10], [9]).pass).toBe(true);
    expect(beatsMatch([10], [11]).pass).toBe(true);
    expect(beatsMatch([10], [10]).pass).toBe(true);
    expect(beatsMatch([10], [8]).pass).toBe(false);
    expect(beatsMatch([10], [12]).pass).toBe(false);
  });
});
