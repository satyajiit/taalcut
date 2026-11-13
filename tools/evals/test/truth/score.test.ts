// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * BRK1-ACC: a template scored against a reel's truth file. A made-up 10-second landscape reel: three cuts, a fade
 * at the end, one overlay, music at 120 BPM.
 */
import { describe, expect, it } from 'vitest';
import { FrameRate, RationalTime, type Template } from '@taalcut/core';
import { truthSchema } from '../../src/truth/schema';
import { scoreTemplate } from '../../src/truth/score';

const rate = FrameRate.of(30);
const ms = FrameRate.of(1000);
const at = (frame: number) => RationalTime.of(frame, rate);

const truth = truthSchema.parse({
  reelId: 'made-up',
  frameRate: { numerator: 30, denominator: 1 },
  source: { durationFrames: 300, width: 1280, height: 720, orientation: 'landscape' },
  cuts: [90, 150, 210],
  notCuts: [{ frame: 120 }, { frame: 290 }],
  transitions: [{ kind: 'fade', startFrame: 280, endFrame: 296 }],
  shots: [0, 90, 150, 210].map((startFrame, i, all) => ({
    startFrame,
    endFrame: all[i + 1] ?? 300,
    subjectWords: ['dog', 'puppy'],
    cameraMotions: ['tracking', 'handheld'],
    static: false,
  })),
  overlays: [
    { text: 'Walk time', startFrame: 10, endFrame: 80, box: { x: 0.4, y: 0.1, width: 0.2, height: 0.06 } },
  ],
  tempo: { bpm: 120, beatsPerBar: 4, downbeatsMs: [500, 2500, 4500] },
  speech: { present: false },
  expectedDoubts: { template: ['soundCreditMissing'] },
});

interface SlotSketch {
  readonly start: number;
  readonly end: number;
  readonly text: string;
  readonly subject: string | null;
  readonly motion: string | null;
}

function template(options: {
  slots: SlotSketch[];
  text: { text: string; start: number; end: number; scene?: boolean }[];
  canvas: { width: number; height: number };
  bpm: number;
  downbeats: number[];
  speech: number;
  doubts?: string[];
}): Template {
  const beats = Array.from({ length: 20 }, (_, k) =>
    RationalTime.of(Math.round(500 + k * (60_000 / options.bpm)), ms),
  );
  return {
    canvas: { ...options.canvas, rate },
    slots: options.slots.map((slot) => ({
      start: at(slot.start),
      duration: at(slot.end - slot.start),
      intent: { text: slot.text, subject: slot.subject, motion: slot.motion, source: 'analyst' },
    })),
    text: options.text.map((item) => ({
      text: item.text,
      start: at(item.start),
      duration: at(item.end - item.start),
      ...(item.scene ? { doubts: [{ reason: 'textMaybeScene' }] } : {}),
    })),
    beatMap: { rate: ms, beats, downbeats: options.downbeats, bpm: options.bpm, beatsPerBar: 4 },
    audio: {
      speech:
        options.speech > 0
          ? { segments: Array.from({ length: options.speech }, () => ({ text: '[music]' })) }
          : null,
    },
    ...(options.doubts ? { doubts: options.doubts.map((reason) => ({ reason })) } : {}),
  } as unknown as Template;
}

describe('scoreTemplate', () => {
  it('counts what a weak breakdown gets wrong', () => {
    const still = { subject: 'street', motion: 'static' };
    const score = scoreTemplate(
      template({
        slots: [
          { start: 0, end: 90, text: 'street, static', ...still },
          { start: 90, end: 120, text: 'street, static', ...still },
          { start: 120, end: 150, text: 'street, static', ...still },
          { start: 150, end: 290, text: 'street, static', ...still },
          { start: 290, end: 300, text: 'black', subject: null, motion: null },
        ],
        text: [
          { text: 'Walk time', start: 10, end: 80 },
          { text: 'CAFE', start: 100, end: 140 },
        ],
        canvas: { width: 1080, height: 1920 },
        bpm: 117,
        downbeats: [0, 2, 4, 6, 8],
        speech: 1,
      }),
      truth,
    );
    expect(score.cuts).toEqual({ truth: 3, found: 2, missed: [210], false: [120, 290], notCutsHit: 2 });
    expect(score.fadeTailSlot).toBe(true);
    expect(score.overlays).toMatchObject({ kept: 1, sceneKept: 1, sceneUnmarked: 1 });
    expect(score.intents).toEqual({
      slots: 5,
      withSubject: 0,
      cameraMotionFair: 0,
      staticWhenMoving: 4,
      duplicates: 3,
    });
    expect(score.speech).toEqual({ segments: 1, hallucinated: 1 });
    expect(score.tempo.errorPercent).toBe(-2.5);
    // At 117 BPM every other beat drifts: 500 and 2551 ms are within an eighth of a beat of the truth, 4603 isn't.
    expect(score.downbeats).toMatchObject({ truth: 3, matched: 2, extra: 3 });
    expect(score.orientation).toEqual({ canvas: '1080x1920', defaultPreset: 'device', matches: false });
    expect(score.doubts.expectedMissing).toEqual(['soundCreditMissing']);
  });

  it('scores a good one clean', () => {
    const slot = (start: number, end: number, text: string): SlotSketch => ({
      start,
      end,
      text,
      subject: 'dog',
      motion: 'tracking',
    });
    const score = scoreTemplate(
      template({
        slots: [
          slot(0, 90, 'a dog runs along a beach, the camera following'),
          slot(90, 150, 'the dog jumps a log as the camera tracks it'),
          slot(150, 210, 'the dog shakes off water, handheld'),
          slot(210, 300, 'the dog walks away as the picture fades'),
        ],
        text: [
          { text: 'Walk time', start: 10, end: 80 },
          { text: 'CAFE', start: 100, end: 140, scene: true },
        ],
        canvas: { width: 1080, height: 608 },
        bpm: 120,
        downbeats: [0, 4, 8],
        speech: 0,
        doubts: ['soundCreditMissing'],
      }),
      truth,
    );
    expect(score.cuts).toMatchObject({ found: 3, false: [], missed: [] });
    expect(score.fadeTailSlot).toBe(false);
    expect(score.overlays).toMatchObject({ kept: 1, keptMarked: 0, sceneMarked: 1, sceneUnmarked: 0 });
    expect(score.intents).toMatchObject({
      withSubject: 4,
      cameraMotionFair: 4,
      staticWhenMoving: 0,
      duplicates: 0,
    });
    expect(score.tempo.errorPercent).toBe(0);
    expect(score.downbeats).toMatchObject({ matched: 3, extra: 0 });
    expect(score.orientation).toMatchObject({ defaultPreset: 'landscape', matches: true });
    expect(score.doubts).toMatchObject({ expectedMissing: [], text: 1 });
  });
});
