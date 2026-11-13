// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { describe, expect, it } from 'vitest';
import { DEFAULT_REEL_ID, reelById } from '#content/reels';
import { SAMPLE_ROLL } from '#components/showcase/auto-pick/roll';
import {
  GRIP_PX,
  LANES_MIN_PX,
  closestOnRow,
  cutRange,
  cutToBeat,
  gripReach,
  nudgeCut,
  onBeat,
  snapCut,
} from '#components/showcase/breakdown/cuts';
import { sampleBreakdown, textRows } from '#components/showcase/breakdown/sample';
import { framesOf } from '#components/showcase/frames';
import { FRAME, formatLength, formatTime, toFrame } from '#components/showcase/timecode';

describe('the sample breakdown', () => {
  const sample = sampleBreakdown();
  const reel = reelById(DEFAULT_REEL_ID);

  it('is the reel’s own slots: 13 shots, a cut where each slot starts, in order inside the reel', () => {
    expect(sample.shots).toHaveLength(13);
    expect(sample.shots).toHaveLength(reel.slots.length);
    expect(sample.cuts).toHaveLength(sample.shots.length - 1);
    const times = sample.cuts.map((c) => c.at);
    expect(times).toEqual(reel.slots.slice(1).map((s) => toFrame(s.start)));
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(times.every((t) => t > 0 && t < sample.duration)).toBe(true);
  });

  it('names every shot from what its frames show, and shows that clip’s frames', () => {
    for (const [i, shot] of sample.shots.entries()) {
      expect(shot.clipId).toBe(reel.slots[i]?.pick.clipId);
      expect(shot.word).toBe(SAMPLE_ROLL.find((c) => c.id === shot.clipId)?.short);
      expect(framesOf(shot.clipId).length).toBeGreaterThan(0);
    }
  });

  it('flags the cut the reel is unsure of, and only that one', () => {
    const flagged = sample.cuts.flatMap((c, i) => (c.doubt ? [i] : []));
    const unsure = reel.slots.slice(1).flatMap((s, i) => (s.uncertainCut ? [i] : []));
    expect(flagged).toEqual(unsure);
    expect(flagged).toHaveLength(1);
  });

  it('shows the reel’s own text on screen inside the reel, each running forwards, and invents no transitions', () => {
    expect(sample.texts.map((t) => t.text)).toEqual(['How’s Vietnam?', 'Well…']);
    for (const span of sample.texts) {
      expect(span.end, span.text).toBeGreaterThan(span.start);
      expect(span.start).toBeGreaterThanOrEqual(0);
      expect(span.end).toBeLessThanOrEqual(sample.duration);
    }
    // Both lines sit over the first shot, before its cut.
    expect(Math.max(...sample.texts.map((t) => t.end))).toBeLessThanOrEqual(sample.cuts[0]?.at ?? 0);
    expect(Object.keys(sample)).not.toContain('marks');
  });

  it('puts text that overlaps in time on rows of its own', () => {
    expect(textRows(sample.texts)).toEqual([0, 1]);
    expect(
      textRows([
        { text: 'a', start: 0, end: 1 },
        { text: 'b', start: 1, end: 2 },
        { text: 'c', start: 1.5, end: 3 },
      ]),
    ).toEqual([0, 0, 1]);
  });
});

describe('the cut grips (WCAG 2.5.8)', () => {
  const sample = sampleBreakdown();
  const times = sample.cuts.map((c) => c.at);

  it('fit the sample at the lanes’ narrowest width: two grips on one row never share a 24 px target', () => {
    const apart = (closestOnRow(times) / sample.duration) * LANES_MIN_PX;
    expect(apart).toBeGreaterThanOrEqual(GRIP_PX + 2);
    // The container query that shows the "scroll sideways" line is written for the same width.
    expect(LANES_MIN_PX).toBe(36 * 16);
  });

  it('reach half the way to the next cut on their row, or to the reel’s end', () => {
    expect(closestOnRow([1, 2])).toBe(Number.POSITIVE_INFINITY);
    expect(closestOnRow([1, 1.2, 1.5, 3])).toBeCloseTo(0.5);
    expect(gripReach([1, 1.2, 1.5, 3], 0, 4)).toEqual([1, 0.25]);
    expect(gripReach([1, 1.2, 1.5, 3], 2, 4)[0]).toBeCloseTo(0.25);
    expect(gripReach([1, 1.2, 1.5, 3], 3, 4)).toEqual([0.9, 1]);
  });
});

describe('moving a cut', () => {
  const beats = [0, 0.5, 1, 1.5, 2, 2.5, 3];
  const times = [1, 2];

  it('moves a frame at a time and never past its neighbours or off the reel', () => {
    expect(nudgeCut(times, 0, 1, 3)).toBeCloseTo(toFrame(1 + FRAME));
    expect(nudgeCut(times, 0, -1, 3)).toBeCloseTo(toFrame(1 - FRAME));
    const [min, max] = cutRange(times, 0, 3);
    expect(min).toBeCloseTo(FRAME);
    expect(max).toBeCloseTo(toFrame(2 - FRAME));
    expect(nudgeCut([FRAME], 0, -1, 3)).toBeCloseTo(FRAME);
    expect(nudgeCut([1, toFrame(1 + FRAME * 2)], 0, 1, 3)).toBeCloseTo(toFrame(1 + FRAME));
  });

  it('jumps to the next beat each way, and stays put when there is none it may reach', () => {
    expect(cutToBeat(times, 0, 1, beats, 3)).toBeCloseTo(1.5);
    expect(cutToBeat(times, 0, -1, beats, 3)).toBeCloseTo(0.5);
    expect(cutToBeat([1.6], 0, 1, [0, 1, 1.5], 3)).toBeCloseTo(1.6);
    expect(cutToBeat(times, 1, 1, beats, 3)).toBeCloseTo(2.5);
  });

  it('knows a time on a beat, within half a frame', () => {
    expect(onBeat(1, beats)).toBe(true);
    expect(onBeat(1 + FRAME / 4, beats)).toBe(true);
    expect(onBeat(1.1, beats)).toBe(false);
  });

  it('snaps a dragged cut to a beat within 80 ms, else to the frame', () => {
    expect(snapCut(times, 0, 1.46, beats, 3)).toBeCloseTo(1.5);
    expect(snapCut(times, 0, 1.3, beats, 3)).toBeCloseTo(toFrame(1.3));
    expect(snapCut(times, 0, 2.7, beats, 3)).toBeCloseTo(toFrame(2 - FRAME));
  });
});

describe('the showcases’ clock', () => {
  it('writes timecodes and lengths the way the app does', () => {
    expect(formatTime(5.375)).toBe('0:05.38');
    expect(formatTime(0)).toBe('0:00.00');
    expect(formatTime(61.999)).toBe('1:02.00');
    expect(formatTime(14, false)).toBe('0:14');
    expect(formatLength(14)).toBe('14 s');
    expect(formatLength(2.44)).toBe('2.4 s');
  });
});
