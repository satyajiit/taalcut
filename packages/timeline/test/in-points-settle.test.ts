// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FIX-TRIM: casting step 5 waits for the action to be under way. Synthetic curves at 30 fps (a sample every 3
 * frames): a person only starting to move is a motion curve that climbs to its steady level, a person coming to a
 * stop one that falls from it, and sharpness is flat, as on the footage that showed it.
 */
import { FrameRates, type ShotProfile } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { CASTING_CONFIG } from '../src/casting/config';
import { selectInPoint } from '../src/casting/in-points';
import { settleOf, settlePenalty } from '../src/casting/settle';
import { slotSpecs, type SlotSpec } from '../src/casting/slots';
import { makeProfile, unitVector } from './fixtures/library';
import { buildTemplate } from './fixtures/template';

/** The recording's own ends are off here, so these shots read as shots alone: recording.test.ts has them. */
const config = {
  ...CASTING_CONFIG,
  inPoint: {
    ...CASTING_CONFIG.inPoint,
    recording: { ...CASTING_CONFIG.inPoint.recording, startWeight: 0, endWeight: 0 },
  },
};
const settle = config.inPoint.settle;
const fps30 = FrameRates.fps30;
const framesAt = (index: number) => index * 3;

/** A one-second slot after the opening; `anchored` keeps its beat anchor. */
function slot(anchored = false): SlotSpec {
  const spec = slotSpecs(buildTemplate({ rate: fps30, slots: [{ frames: 15 }, { frames: 30 }] }), config)[1]!;
  return anchored ? spec : { ...spec, anchorRel: null };
}

/** A shot of `frames` frames with this motion curve (a function of the sample), flat sharpness, and no peaks. */
function shot(
  frames: number,
  motion: (index: number) => number,
  extra: Partial<ShotProfile> = {},
): ShotProfile {
  const base = makeProfile({ embedding: unitVector(7), frames, peaks: [] });
  return {
    ...base,
    motionCurve: base.motionCurve!.map((_, index) => motion(index)),
    sharpnessCurve: base.sharpnessCurve!.map(() => 0.5),
    ...extra,
  };
}

/** Still for the first 1.2 s (12 samples, frame 36), then walking. */
const rampUp = (index: number) => (index < 12 ? 0.01 * index : 0.4);
const steady = () => 0.4;
const start = (profile: ShotProfile, spec = slot()) => selectInPoint(profile, spec, fps30, config, false)!;

describe('settled action: the onset and the stop', () => {
  it('finds the climb to the steady level, and none on a still or steady shot', () => {
    expect(settleOf(shot(180, rampUp).motionCurve, 180, framesAt, settle, 100)).toEqual({
      onsetEnd: 36,
      stopStart: 180,
    });
    expect(settleOf(shot(180, steady).motionCurve, 180, framesAt, settle, 100)).toEqual({
      onsetEnd: 0,
      stopStart: 180,
    });
    expect(settleOf(shot(180, () => 0.02).motionCurve, 180, framesAt, settle, 100)).toEqual({
      onsetEnd: 0,
      stopStart: 180,
    });
    expect(settleOf(null, 180, framesAt, settle, 100)).toEqual({ onsetEnd: 0, stopStart: 180 });
    // The last second falls still: the stop starts at sample 50.
    const stopping = shot(180, (index) => (index >= 50 ? 0.03 : 0.4));
    expect(settleOf(stopping.motionCurve, 180, framesAt, settle, 100)).toEqual({
      onsetEnd: 0,
      stopStart: 150,
    });
  });

  it('caps the onset at 1.5 s and at half the shot', () => {
    const slowStart = shot(300, (index) => (index < 30 ? 0.02 : 0.4));
    expect(settleOf(slowStart.motionCurve, 300, framesAt, settle, 100).onsetEnd).toBe(45);
    // 16 samples, steady from sample 10 after a stuttering start: the onset stops at half the shot, sample 8.
    const stutter = (index: number) => (index < 4 || (index < 10 && index % 2 === 1) ? 0.02 : 0.4);
    expect(settleOf(shot(48, stutter).motionCurve, 48, framesAt, settle, 100).onsetEnd).toBe(24);
  });

  it('weighs a window by its share in the onset or the stop', () => {
    const at = { onsetEnd: 36, stopStart: 150 };
    expect(settlePenalty(at, 180, 0, 30, settle)).toBeCloseTo(settle.onsetWeight, 9);
    expect(settlePenalty(at, 180, 21, 30, settle)).toBeCloseTo(settle.onsetWeight / 2, 9);
    expect(settlePenalty(at, 180, 36, 30, settle)).toBe(0);
    expect(settlePenalty(at, 180, 120, 30, settle)).toBe(0);
    expect(settlePenalty(at, 180, 150, 30, settle)).toBeCloseTo(settle.stopWeight, 9);
  });
});

describe('in-points wait for the action', () => {
  it('lands a ramp-up shot’s window after the ramp', () => {
    const point = start(shot(180, rampUp));
    expect(point.sourceStart.value).toBeGreaterThanOrEqual(36);
    expect(point.aligned).toBe(false);
  });

  it('lands near the best frame on flat sharpness, not at the shot’s start, and at the middle with none', () => {
    expect(start(shot(180, steady, { bestFrame: 120 })).sourceStart.value).toBe(105);
    expect(start(shot(180, steady, { bestFrame: 0 })).sourceStart.value).toBe(0);
    expect(start(shot(180, steady)).sourceStart.value).toBe(75);
    expect(start(shot(180, steady, { bestFrame: null })).sourceStart.value).toBe(75);
  });

  it('keeps out of the onset when the best frame falls inside it', () => {
    // The best-frame pull would start the window at 0; the onset wins, and the pull keeps it as early as is settled.
    expect(start(shot(180, rampUp, { bestFrame: 10 })).sourceStart.value).toBe(36);
  });

  it('keeps out of a trailing stop', () => {
    const stopping = shot(180, (index) => (index >= 50 ? 0.03 : 0.4), { bestFrame: 165 });
    const point = start(stopping);
    expect(point.sourceStart.value + 30).toBeLessThanOrEqual(150);
    expect(point.sourceStart.value).toBe(120);
  });

  it('still lands an aligned peak on the beat within the tolerance', () => {
    const spec = slot(true);
    const lead = spec.anchorRel!;
    // Sharper early and the best frame early: an unaligned window would sit there, but the peak on the beat wins.
    const base = makeProfile({ embedding: unitVector(8), frames: 240, peaks: [140] });
    const profile = {
      ...base,
      sharpnessCurve: base.sharpnessCurve!.map((_, index) => (index < 20 ? 0.6 : 0.5)),
      bestFrame: 20,
    };
    const point = selectInPoint(profile, spec, fps30, config, false)!;
    expect(point.aligned).toBe(true);
    expect(point.syncPoint!.value).toBe(140);
    expect(Math.abs(140 - point.sourceStart.value - lead)).toBeLessThanOrEqual(1);
  });

  it('drops a peak inside the onset for a settled one, or for no sync point', () => {
    const spec = slot(true);
    const lead = spec.anchorRel!;
    // A step on the beat while still getting going: not worth opening on.
    const early = shot(180, rampUp, { motionPeakFrames: [lead + 2] });
    const off = selectInPoint(early, spec, fps30, config, false)!;
    expect(off.aligned).toBe(false);
    expect(off.syncPoint).toBeNull();
    expect(off.sourceStart.value).toBeGreaterThanOrEqual(36);
    const both = shot(180, rampUp, { motionPeakFrames: [lead + 2, 120] });
    const on = selectInPoint(both, spec, fps30, config, false)!;
    expect(on.aligned).toBe(true);
    expect(on.syncPoint!.value).toBe(120);
  });

  it('keeps working on a short shot with no room to wait', () => {
    const climbing = (index: number) => (index < 4 ? 0.05 : 0.4);
    // As long as the window: its start.
    expect(start(shot(30, climbing)).sourceStart.value).toBe(0);
    // Ten frames of room, every window in the 12-frame onset: the latest is the most settled, and a peak on the beat
    // a little earlier still counts, being about as settled as the shot allows.
    expect(start(shot(40, climbing)).sourceStart.value).toBe(10);
    const spec = slot(true);
    const peaked = shot(40, climbing, { motionPeakFrames: [8 + spec.anchorRel!] });
    const point = selectInPoint(peaked, spec, fps30, config, false)!;
    expect(point.aligned).toBe(true);
    expect(point.sourceStart.value).toBeGreaterThanOrEqual(7);
    expect(point.sourceStart.value).toBeLessThanOrEqual(9);
  });
});
