// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Two-method merge: confirmed, dropped and disputed by threshold; soft cuts; the rule without a verdict. */
import { describe, expect, it } from 'vitest';
import {
  BREAKDOWN_CONFIG,
  contextDistance,
  cosineDistance,
  judgeProposal,
  locateChanges,
  locateRamp,
  proposeCuts,
  scanFrames,
  softCut,
  softWindows,
} from '../src/index';

const config = BREAKDOWN_CONFIG;
const v = (...values: number[]) => Float32Array.from(values);

/** Shots of unit vectors; a dissolve blends two of them linearly. */
function reel(spec: { cuts: number[]; dissolve?: { start: number; end: number }; total: number }) {
  const colours = [v(1, 0, 0), v(0, 1, 0), v(0, 0, 1), v(1, 1, 0), v(0, 1, 1), v(1, 0, 1)];
  const shotOf = (frame: number) => spec.cuts.filter((cut) => cut <= frame).length;
  return (frame: number) => {
    if (frame < 0 || frame >= spec.total) return undefined;
    const d = spec.dissolve;
    if (d && frame >= d.start && frame <= d.end) {
      const t = (frame - d.start + 1) / (d.end - d.start + 2);
      const a = colours[shotOf(d.start - 1) % colours.length]!;
      const b = colours[(shotOf(d.start - 1) + 1) % colours.length]!;
      return Float32Array.from(a, (x, i) => (1 - t) * x + t * b[i]!);
    }
    const shot = d && frame > d.end ? shotOf(frame) + 1 : shotOf(frame);
    return colours[shot % colours.length];
  };
}

describe('method A proposals', () => {
  it('takes the peak of nearby proposals and never frame 0', () => {
    const scores = Array.from({ length: 40 }, () => 0.5);
    scores[0] = 99;
    scores[10] = 9;
    scores[11] = 40;
    scores[12] = 12;
    scores[30] = 30;
    expect(proposeCuts(scores, config)).toEqual([11, 30]);
  });
});

describe('method B judges each proposal', () => {
  it('confirms, drops and disputes by distance', () => {
    expect(judgeProposal(10, 30, 0.6, config)).toMatchObject({ status: 'confirmed', method: 'both' });
    // A flash: big scene score, same picture before and after.
    expect(judgeProposal(10, 60, 0.02, config)).toBeNull();
    expect(judgeProposal(10, 12, 0.15, config)).toMatchObject({
      status: 'disputed',
      method: 'scdet',
      ruleKeeps: false,
    });
    expect(judgeProposal(10, 30, 0.15, config)).toMatchObject({ status: 'disputed', ruleKeeps: true });
    // No embeddings: A alone decides only when strong.
    expect(judgeProposal(10, 30, null, config)).toMatchObject({ status: 'confirmed', method: 'scdet' });
    expect(judgeProposal(10, 9, null, config)).toMatchObject({ status: 'disputed', ruleKeeps: false });
  });

  it('measures the jump between the frames before and after the cut', () => {
    const vectorAt = reel({ cuts: [20], total: 40 });
    expect(contextDistance(vectorAt, 20, 40, 3)).toBeCloseTo(1);
    expect(contextDistance(vectorAt, 10, 40, 3)).toBeCloseTo(0);
    expect(contextDistance(() => undefined, 10, 40, 3)).toBeNull();
    expect(cosineDistance(v(0, 0), v(0, 0))).toBe(0);
  });
});

describe('soft cuts from the scan', () => {
  it('finds a 12-frame dissolve A missed and puts the cut in its middle', () => {
    const vectorAt = reel({ cuts: [], dissolve: { start: 40, end: 51 }, total: 120 });
    const scan = scanFrames(120, 30, 4);
    const windows = softWindows(scan, vectorAt, config);
    expect(windows.length).toBe(1);
    const [change] = locateChanges(windows[0]!, vectorAt, 120, config);
    expect(change).toMatchObject({ hard: false });
    expect(Math.abs(change!.frame - 46)).toBeLessThanOrEqual(2);
    expect(change!.end - change!.start).toBeGreaterThanOrEqual(6);
    expect(softCut(change!, config)).toMatchObject({
      method: 'embedding',
      status: 'disputed',
      ruleKeeps: true,
    });
  });

  it('finds both cuts of a two-frame shot as one-frame jumps on the new shots', () => {
    const vectorAt = reel({ cuts: [42, 44], total: 120 });
    const windows = softWindows(scanFrames(120, 30, 4), vectorAt, config);
    const changes = windows.flatMap((window) => locateChanges(window, vectorAt, 120, config));
    expect(changes.map((change) => [change.frame, change.hard])).toEqual([
      [42, true],
      [44, true],
    ]);
    expect(softCut(changes[0]!, config).ramp).toBeNull();
    expect(locateRamp([0, 10], reel({ cuts: [], total: 40 }), config)).toBeNull();
  });

  it('samples the scan at the configured rate', () => {
    expect(scanFrames(31, 30, 4)).toEqual([0, 8, 15, 23, 30]);
    expect(scanFrames(10, 30000 / 1001, 4).length).toBeGreaterThan(0);
  });
});
