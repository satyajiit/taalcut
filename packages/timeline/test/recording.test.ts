// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FIX-TRIM: an in-point keeps out of the recording's first second and last half second (recording.ts). Made-up
 * shots at 30 fps with flat sharpness and a steady motion curve, so only the handles and the best frame decide; the
 * slot takes a one-second window.
 */
import { FrameRates, RationalTime, TimeRange, type ShotProfile } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { CASTING_CONFIG } from '../src/casting/config';
import { selectInPoint } from '../src/casting/in-points';
import { recordingHandles, recordingPenalty } from '../src/casting/recording';
import { slotSpecs, type SlotSpec } from '../src/casting/slots';
import { makeProfile, unitVector } from './fixtures/library';
import { buildTemplate } from './fixtures/template';

const config = CASTING_CONFIG;
const recording = config.inPoint.recording;
const fps30 = FrameRates.fps30;
const WINDOW = 30;

function slot(anchored = false): SlotSpec {
  const spec = slotSpecs(buildTemplate({ rate: fps30, slots: [{ frames: 15 }, { frames: 30 }] }), config)[1]!;
  return anchored ? spec : { ...spec, anchorRel: null };
}

/**
 * A shot of `frames` frames starting `offset` frames into a file `fileFrames` long (by default 30 frames past the
 * shot's end), steady and flat.
 */
function shot(
  frames: number,
  options: { offset?: number; fileFrames?: number; extra?: Partial<ShotProfile> } = {},
): ShotProfile {
  const offset = options.offset ?? 0;
  const base = makeProfile({ embedding: unitVector(9), frames, offset, peaks: [] });
  return {
    ...base,
    available: TimeRange.of(
      RationalTime.zero(fps30),
      RationalTime.of(options.fileFrames ?? offset + frames + 30, fps30),
    ),
    motionCurve: base.motionCurve!.map(() => 0.4),
    sharpnessCurve: base.sharpnessCurve!.map(() => 0.5),
    ...options.extra,
  };
}

/** The in-point's frame from the shot's start. */
const startOf = (profile: ShotProfile, spec = slot()) =>
  selectInPoint(profile, spec, fps30, config, false)!.sourceStart.value - profile.range.start.value;

describe('the recording’s handles', () => {
  it('fall on a shot by where it sits in its file', () => {
    expect(recordingHandles(shot(180), WINDOW, recording)).toEqual({
      start: 30,
      end: 15,
      startEnd: 30,
      endStart: 180,
    });
    // Half a second into the file: the rest of its first second.
    expect(recordingHandles(shot(180, { offset: 15 }), WINDOW, recording).startEnd).toBe(15);
    // Mid-file: neither.
    expect(recordingHandles(shot(180, { offset: 60 }), WINDOW, recording)).toMatchObject({
      startEnd: 0,
      endStart: 180,
    });
    // To the file's end: its last half second.
    expect(recordingHandles(shot(180, { fileFrames: 180 }), WINDOW, recording).endStart).toBe(165);
    expect(recordingHandles(shot(180, { fileFrames: 190 }), WINDOW, recording).endStart).toBe(175);
  });

  it('shrink on a file too short for the window and both, keeping a share of each', () => {
    // 1.2 s file, 1 s window: 6 frames of room for 30 + 15 frames of handles.
    expect(recordingHandles(shot(36, { fileFrames: 36 }), WINDOW, recording)).toEqual({
      start: 4,
      end: 2,
      startEnd: 4,
      endStart: 34,
    });
    expect(recordingHandles(shot(30, { fileFrames: 30 }), WINDOW, recording)).toMatchObject({
      start: 0,
      end: 0,
    });
  });

  it('weigh a window by its share inside each, the start more', () => {
    const handles = recordingHandles(shot(180, { fileFrames: 180 }), WINDOW, recording);
    expect(recordingPenalty(handles, 0, WINDOW, recording)).toBe(recording.startWeight);
    expect(recordingPenalty(handles, 15, WINDOW, recording)).toBeCloseTo(recording.startWeight / 2, 9);
    expect(recordingPenalty(handles, 30, WINDOW, recording)).toBe(0);
    expect(recordingPenalty(handles, 150, WINDOW, recording)).toBe(recording.endWeight);
    expect(recording.startWeight).toBeGreaterThan(recording.endWeight);
  });

  it('none on a photo, or a video with no file range', () => {
    const photo = makeProfile({ embedding: unitVector(9), kind: 'image' });
    expect(recordingHandles(photo, WINDOW, recording)).toMatchObject({ start: 0, end: 0 });
    expect(recordingHandles({ ...shot(180), available: null }, WINDOW, recording)).toMatchObject({
      start: 0,
      end: 0,
    });
  });
});

describe('in-points keep out of the recording’s ends', () => {
  it('open a second into the file, though the best frame is its first', () => {
    expect(startOf(shot(180, { extra: { bestFrame: 0 } }))).toBe(30);
    // A pick 0.35 s in, pulled there by the best frame: a second in.
    expect(startOf(shot(180, { extra: { bestFrame: 25 } }))).toBe(30);
  });

  it('open at a mid-file shot’s own start: the handle is the file’s, not the shot’s', () => {
    expect(startOf(shot(180, { offset: 60, extra: { bestFrame: 0 } }))).toBe(0);
    // Half a second into the file: the shot's first half second waits.
    expect(startOf(shot(180, { offset: 15, extra: { bestFrame: 0 } }))).toBe(15);
  });

  it('beat a sharper first second and the best frame’s pull', () => {
    const sharpFirst = shot(180, { extra: { bestFrame: 5 } });
    const sharper = {
      ...sharpFirst,
      sharpnessCurve: sharpFirst.sharpnessCurve!.map((_, i) => (i < 10 ? 0.9 : 0.5)),
    };
    expect(startOf(sharper)).toBe(30);
  });

  it('stop half a second before the file ends', () => {
    const toTheEnd = shot(180, { fileFrames: 180, extra: { bestFrame: 179 } });
    expect(startOf(toTheEnd) + WINDOW).toBe(165);
  });

  it('drop a peak on the beat inside the first second', () => {
    const spec = slot(true);
    const early = shot(180, { extra: { motionPeakFrames: [spec.anchorRel! + 2], bestFrame: 0 } });
    const point = selectInPoint(early, spec, fps30, config, false)!;
    expect(point.aligned).toBe(false);
    expect(point.sourceStart.value).toBe(30);
  });

  it('fit a 1.2 s file between its shrunk handles', () => {
    expect(startOf(shot(36, { fileFrames: 36, extra: { bestFrame: 0 } }))).toBe(4);
  });
});
