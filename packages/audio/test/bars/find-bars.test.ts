// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LONG1: bars from the samples alone. The owner's reel is 470 frames at 30 fps and its music repeats every two
 * bars; the piece here has two bars of exactly 129 frames, so the finder's answer is checked to the frame.
 */
import { describe, expect, it } from 'vitest';
import { findMusicBars, repeatSeam } from '../../src/bars/find-bars';
import { clickTrack, noise, tone } from '../listen/dsp-signals';
import { loop, loopBars, type LoopSpec } from './loop';

const FPS = 30;
/** Two bars are 129 frames: a bar is 2.15 s, a beat 0.5375 s (111.6 beats a minute). */
const REEL: LoopSpec = { seconds: 470 / FPS, beat: 129 / FPS / 8, firstBar: 1.5, dropAt: 10.1 };

describe('findMusicBars', () => {
  it('measures the bar of a 470-frame piece to the frame: two bars are 129 frames', () => {
    const bars = findMusicBars(loop(REEL));
    expect(bars.steady).toBe(true);
    expect(bars.beatsPerBar).toBe(4);
    expect(Math.abs((bars.barSeconds ?? 0) - 2.15)).toBeLessThan(0.002);
    expect(Math.round(2 * (bars.barSeconds ?? 0) * FPS)).toBe(129);
    expect(Math.abs((bars.bpm ?? 0) - 111.63)).toBeLessThan(0.1);
    expect(bars.sure.pulse).toBeGreaterThan(0.5);
    expect(bars.sure.onBeat).toBeGreaterThan(0.9);
  });

  it('puts each bar line on its attack, within 5 ms, the first beat of the bar found', () => {
    const bars = findMusicBars(loop(REEL));
    const truth = loopBars(REEL);
    expect(bars.bars).toHaveLength(truth.length);
    bars.bars.forEach((bar, index) => expect(Math.abs(bar.at - (truth[index] ?? 0))).toBeLessThan(0.005));
    expect(bars.sure.firstBeat).toBeGreaterThan(0.2);
  });

  it('lists where the music changes strongly: the drop, with its level', () => {
    const bars = findMusicBars(loop(REEL));
    const drop = bars.changes.find((change) => Math.abs(change.at - 10.1) < 0.01);
    expect(drop).toBeDefined();
    expect(drop?.levelDb).toBeGreaterThan(3);
    // The bar that starts on the drop is the one that differs from the bar before.
    const bar = bars.bars.find((item) => Math.abs(item.at - 10.1) < 0.01);
    const others = bars.bars.filter((item) => item !== bar && item.fromBarBefore !== null);
    expect(bar?.fromBarBefore ?? 0).toBeGreaterThan(
      Math.max(...others.map((item) => item.fromBarBefore ?? 0)),
    );
  });

  it('reads the same bar on a click track, to a millisecond per beat', () => {
    for (const bpm of [90, 120, 140]) {
      const bars = findMusicBars(clickTrack(bpm, 16));
      expect(bars.steady).toBe(true);
      expect(Math.abs((bars.beatSeconds ?? 0) - 60 / bpm)).toBeLessThan(0.001);
      expect(bars.beatsPerBar).toBe(4);
      expect(Math.abs((bars.bars[0]?.at ?? 0) - 0.1)).toBeLessThan(0.005);
    }
  });

  it('counts three to the bar when the music does', () => {
    const waltz = findMusicBars(loop({ seconds: 16, beat: 0.5, firstBar: 0.5, beatsPerBar: 3 }));
    expect(waltz.steady).toBe(true);
    expect(waltz.beatsPerBar).toBe(3);
    expect(Math.abs((waltz.barSeconds ?? 0) - 1.5)).toBeLessThan(0.003);
  });

  it('answers no steady pulse, with the numbers, for sound without one', () => {
    const hiss = findMusicBars(noise(12, 0.2, 4));
    expect(hiss.steady).toBe(false);
    expect(hiss.why).toMatch(/No steady pulse/);
    expect(hiss.bars).toEqual([]);
    const held = findMusicBars(tone(220, 12, 0.3));
    expect(held.steady).toBe(false);
    const short = findMusicBars(clickTrack(120, 3));
    expect(short.steady).toBe(false);
    expect(short.why).toMatch(/3 s long/);
  });
});

describe('repeatSeam', () => {
  it('reads a repeat of whole bars inside one section as the same sound, and one across the drop as not', () => {
    const mono = loop(REEL);
    const inside = repeatSeam(mono, 7.95 - 0.005, 4.3);
    const across = repeatSeam(mono, 12.25 - 0.005, 4.3);
    expect(inside.apartDb).not.toBeNull();
    expect(inside.apartDb ?? 99).toBeLessThan(1.5);
    expect(Math.abs(inside.levelDb ?? 99)).toBeLessThan(1.5);
    expect(across.apartDb ?? 0).toBeGreaterThan((inside.apartDb ?? 0) + 2);
    // Before the drop the music was quieter than it is before this splice.
    expect(across.levelDb ?? 0).toBeLessThan(-2);
  });

  it('has nothing to compare when the music would go back past its start', () => {
    expect(repeatSeam(loop(REEL), 1.5, 4.3)).toMatchObject({ apartDb: null, levelDb: null });
  });
});
