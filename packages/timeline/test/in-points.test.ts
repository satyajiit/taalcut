// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Casting step 5: in-points put a motion peak within ±1 frame of the beat anchor. */
import { type FrameRate, FrameRates, RationalTime } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { CASTING_CONFIG } from '../src/casting/config';
import { selectInPoint, windowFrames } from '../src/casting/in-points';
import { syncPointAt } from '../src/casting/result';
import { slotSpecs, type SlotSpec } from '../src/casting/slots';
import { rampFrames } from '../src/model/speed';
import { makeProfile, unitVector } from './fixtures/library';
import { buildTemplate } from './fixtures/template';

const config = CASTING_CONFIG;

function slot(rate: FrameRate, frames = 30, ramp?: readonly (readonly [number, number])[]): SlotSpec {
  const template = buildTemplate({ rate, slots: [{ frames: 15 }, { frames, ...(ramp ? { ramp } : {}) }] });
  return slotSpecs(template, config)[1]!;
}

/** Where the sync point lands, in canvas frames after the cut. */
function landing(
  point: { sourceStart: RationalTime; syncPoint: RationalTime | null },
  canvas: FrameRate,
): number {
  const lead = RationalTime.subtract(point.syncPoint!, point.sourceStart);
  return (RationalTime.toSeconds(lead) * canvas.num) / canvas.den;
}

describe('in-points', () => {
  for (const [label, canvas, media] of [
    ['30 fps media on a 30 fps canvas', FrameRates.fps30, FrameRates.fps30],
    ['25 fps media on a 30 fps canvas', FrameRates.fps30, FrameRates.fps25],
    ['59.94 fps media on an NTSC canvas', FrameRates.fps29_97, FrameRates.fps59_94],
  ] as const)
    it(`lands a peak within one frame of the anchor: ${label}`, () => {
      const spec = slot(canvas);
      const profile = makeProfile({
        embedding: unitVector(1),
        rate: media,
        frames: 400,
        peaks: [57, 211, 333],
      });
      const point = selectInPoint(profile, spec, canvas, config, false);
      expect(point?.aligned).toBe(true);
      expect(Math.abs(landing(point!, canvas) - spec.anchorRel!)).toBeLessThanOrEqual(1 + 1e-9);
      expect(profile.motionPeakFrames).toContain(point!.syncPoint!.value);
      const last = profile.range.duration.value - windowFrames(spec, media);
      expect(point!.sourceStart.value).toBeLessThanOrEqual(last);
    });

  it('takes the sharpest of the aligned windows, and of equal ones the one nearest the middle (FIX-TRIM)', () => {
    const spec = slot(FrameRates.fps30);
    const flat = makeProfile({ embedding: unitVector(2), frames: 300, peaks: [100, 230] });
    const even = { ...flat, sharpnessCurve: flat.sharpnessCurve!.map(() => 0.5) };
    // The middle of the 270 starts is 135: the windows on 100 sit nearer it than those on 230.
    expect(selectInPoint(even, spec, FrameRates.fps30, config, false)?.syncPoint?.value).toBe(100);
    const sharpLater = {
      ...flat,
      sharpnessCurve: flat.sharpnessCurve!.map((_, index) => (index >= 50 ? 1 : 0.1)),
    };
    expect(selectInPoint(sharpLater, spec, FrameRates.fps30, config, false)?.syncPoint?.value).toBe(230);
  });

  it('falls back to the sharpest window with no sync point when no peak can land', () => {
    const spec = slot(FrameRates.fps30);
    const noPeaks = makeProfile({ embedding: unitVector(3), frames: 120, peaks: [] });
    const point = selectInPoint(noPeaks, spec, FrameRates.fps30, config, false);
    expect(point?.aligned).toBe(false);
    expect(point?.syncPoint).toBeNull();
    const unaligned = makeProfile({ embedding: unitVector(3), frames: 60, peaks: [59] });
    expect(selectInPoint(unaligned, spec, FrameRates.fps30, config, false)?.syncPoint).toBeNull();
  });

  it('weighs the opening on the hook slot', () => {
    const spec = { ...slot(FrameRates.fps30, 90), anchorRel: null };
    const base = makeProfile({ embedding: unitVector(4), frames: 300, peaks: [] });
    const lively = {
      ...base,
      sharpnessCurve: base.sharpnessCurve!.map(() => 0.5),
      motionCurve: base.motionCurve!.map((_, index) => (index >= 60 && index < 75 ? 1 : 0)),
    };
    // Off the hook every window is equal (the curve's middle is still: no onset): the middle one, of starts 0 to 210.
    expect(selectInPoint(lively, spec, FrameRates.fps30, config, false)?.sourceStart.value).toBe(105);
    // Samples 60–74 sit at frames 180–222: the earliest window whose opening holds all of them starts at 178.
    expect(selectInPoint(lively, spec, FrameRates.fps30, config, true)?.sourceStart.value).toBe(178);
  });

  it('needs the media a ramp consumes and refuses a shot too short for it', () => {
    const ramped = slot(FrameRates.fps30, 30, [
      [0, 2],
      [30, 2],
    ]);
    expect(windowFrames(ramped, FrameRates.fps30)).toBe(60);
    const short = makeProfile({ embedding: unitVector(5), frames: 50 });
    expect(selectInPoint(short, ramped, FrameRates.fps30, config, false)).toBeNull();
    const still = makeProfile({ embedding: unitVector(5), kind: 'image' });
    expect(selectInPoint(still, ramped, FrameRates.fps30, config, false)?.syncPoint).toBeNull();
  });

  it("lands a ramped slot's peak on its beat through the ramp's integral, not the speed at its first frame", () => {
    // 0.5x to 2x over the slot, beat 15 frames after the cut: the slot plays rampFrames(15) = 13.125 source
    // frames before the beat. The speed at frame 0 would lead by 7.5 and land the peak about 4 frames early.
    const ramp = [
      [0, 0.5],
      [30, 2],
    ] as const;
    const spec: SlotSpec = { ...slot(FrameRates.fps30, 30, ramp), anchorRel: 15 };
    const profile = makeProfile({ embedding: unitVector(6), frames: 400, peaks: [200] });
    const point = selectInPoint(profile, spec, FrameRates.fps30, config, false);
    expect(point?.aligned).toBe(true);
    expect(point!.syncPoint!.value).toBe(200);
    const lead = point!.syncPoint!.value - point!.sourceStart.value;
    expect(lead).toBeGreaterThanOrEqual(rampFrames(spec.speed!, 14));
    expect(lead).toBeLessThanOrEqual(rampFrames(spec.speed!, 16));
    // The casting result re-derives the sync point the same way.
    const at = (frame: number) => RationalTime.of(frame, FrameRates.fps30);
    expect(syncPointAt(profile, spec, at(187), FrameRates.fps30, config)?.value).toBe(200);
    expect(syncPointAt(profile, spec, at(192), FrameRates.fps30, config)).toBeNull();
  });
});
