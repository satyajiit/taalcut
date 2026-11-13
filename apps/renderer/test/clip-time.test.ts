// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// The clip page's playhead arithmetic: media time to milliseconds, the shot and the line at the playhead, stepping
// between shots the way a player's previous and next do, the lanes' stretches and the ruler's marks.
import type { AssetDetail } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { CLIP_FIXTURE } from '../src/features/library/clip/clip-fixture';
import {
  clampTime,
  clipLength,
  fractionOf,
  lineAt,
  msOf,
  overlaps,
  rulerMarks,
  shotAt,
  shotSpans,
  speechSpans,
  stepShot,
  textSpans,
  timeAtX,
} from '../src/features/library/clip/clip-time';

// The fixture: 870 frames at 30 fps (29 s), shots starting at frames 0, 120, 330, 450 and 600.
const spans = shotSpans(CLIP_FIXTURE.shots);

describe('clip time', () => {
  it('turns media time into milliseconds, at any rate', () => {
    expect(msOf({ value: 90, rate: { num: 30, den: 1 } })).toBe(3000);
    expect(msOf({ value: 30, rate: { num: 30_000, den: 1001 } })).toBeCloseTo(1001);
    expect(clipLength(CLIP_FIXTURE)).toBe(29_000);
  });

  it('measures a clip without a duration by where its last shot or line ends; a photo has none', () => {
    const undated: AssetDetail = {
      ...CLIP_FIXTURE,
      asset: { ...CLIP_FIXTURE.asset, duration: null },
      facts: null,
    };
    expect(clipLength(undated)).toBe(29_000);
    const photo: AssetDetail = { ...undated, shots: [], transcript: null };
    expect(clipLength(photo)).toBe(0);
  });

  it('finds the shot at the playhead, in order, the last one holding the end', () => {
    expect(spans.map((span) => [span.from, span.to])).toEqual([
      [0, 4000],
      [4000, 11_000],
      [11_000, 15_000],
      [15_000, 20_000],
      [20_000, 29_000],
    ]);
    expect(shotAt(spans, 0)?.index).toBe(0);
    expect(shotAt(spans, 3999)?.index).toBe(0);
    expect(shotAt(spans, 4000)?.index).toBe(1);
    expect(shotAt(spans, 29_000)?.index).toBe(4);
    expect(shotAt([], 100)).toBeNull();
  });

  it('steps to the next shot, and back to the start of this one before the one before', () => {
    expect(stepShot(spans, 5000, 1)).toBe(11_000);
    expect(stepShot(spans, 20_500, 1)).toBeNull();
    expect(stepShot(spans, 6000, -1)).toBe(4000);
    expect(stepShot(spans, 4100, -1)).toBe(0);
    expect(stepShot(spans, 0, -1)).toBeNull();
  });

  it('finds the line being said, and none between lines', () => {
    const lines = CLIP_FIXTURE.transcript?.lines ?? [];
    expect(lineAt(lines, 0)).toBe(0);
    expect(lineAt(lines, 8000)).toBe(1);
    expect(lineAt(lines, 7000)).toBeNull();
    expect(speechSpans(lines)[1]).toEqual({
      from: 8000,
      to: 14_000,
      text: 'This market is incredible, there is a bit of everything here.',
    });
  });

  it('finds the moment under a pointer, kept inside the clip', () => {
    const box = { left: 100, width: 400 };
    expect(timeAtX(box, 300, 6000)).toBe(3000);
    expect(timeAtX(box, 40, 6000)).toBe(0);
    expect(timeAtX(box, 900, 6000)).toBe(6000);
    expect(timeAtX({ left: 0, width: 0 }, 10, 6000)).toBe(0);
  });

  it('lists the text on screen once per stretch, in order', () => {
    const range = {
      start: { value: 30, rate: { num: 30, den: 1 } },
      duration: { value: 60, rate: { num: 30, den: 1 } },
    };
    const later = { ...range, start: { value: 300, rate: { num: 30, den: 1 } } };
    const text = (words: string, at: typeof range) => ({
      text: words,
      box: { x: 0, y: 0, width: 1, height: 0.1 },
      range: at,
      confidence: 0.9,
      script: 'latin' as const,
      reveal: 'none' as const,
    });
    const analysis = (texts: ReturnType<typeof text>[]) => ({
      version: 1 as const,
      range,
      bestFrame: 0,
      orientation: 'portrait' as const,
      quality: { version: 1, sharpness: 1, exposure: 1, stability: 1, overall: 1, flags: [] },
      energy: 0.5,
      onScreenText: texts,
      dHash: '0123456789abcdef',
    });
    const [first, second] = CLIP_FIXTURE.shots;
    if (!first || !second) throw new Error('the fixture has shots');
    const shots = [
      { ...second, analysis: analysis([text('SALE', later)]) },
      { ...first, analysis: analysis([text('NEW GEAR', range), text('NEW GEAR', range)]) },
    ];
    expect(textSpans(shots)).toEqual([
      { from: 1000, to: 3000, text: 'NEW GEAR' },
      { from: 10_000, to: 12_000, text: 'SALE' },
    ]);
  });

  it('puts about six labelled marks on the ruler, none crowding its end', () => {
    expect(rulerMarks(29_000)).toEqual([5000, 10_000, 15_000, 20_000, 25_000]);
    expect(rulerMarks(3000)).toEqual([500, 1000, 1500, 2000, 2500]);
    expect(rulerMarks(600_000)).toEqual([120_000, 240_000, 360_000, 480_000]);
    expect(rulerMarks(0)).toEqual([]);
  });

  it('keeps the playhead inside the clip and draws it as a fraction', () => {
    expect(clampTime(-5, 1000)).toBe(0);
    expect(clampTime(1500, 1000)).toBe(1000);
    expect(fractionOf(250, 1000)).toBe(0.25);
    expect(fractionOf(10, 0)).toBe(0);
    expect(overlaps({ from: 0, to: 10 }, { from: 10, to: 20 })).toBe(false);
    expect(overlaps({ from: 0, to: 11 }, { from: 10, to: 20 })).toBe(true);
  });
});
