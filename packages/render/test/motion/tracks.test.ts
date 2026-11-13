// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Tracks as GSAP tweens (SPEC G.2): a set of the value at 0, one explicit fromTo per segment, jumps half a frame
 * early, and a tween that ends where a new value starts ends half a frame sooner, so a seek lands on the same value
 * from either direction.
 */
import { describe, expect, it } from 'vitest';
import { FrameRate } from '@taalcut/core';
import { stepAnimation, trackAnimation } from '../../src/compile/tracks';
import { frameSeconds, jumpSeconds } from '../../src/motion/motion-data';

const rate = FrameRate.of(30);
const ids = { ids: ['e'] };

describe('trackAnimation', () => {
  it('sets the rest value at 0, then one explicit fromTo per segment', () => {
    expect(
      trackAnimation(
        'e',
        'opacity',
        { start: 10, end: 70 },
        1,
        [{ from: 20, to: 35, start: 1, end: 0, easing: 'power2.in' }],
        rate,
      ),
    ).toEqual([
      { targets: ids, at: 0, duration: 0, from: {}, to: { opacity: 1 } },
      {
        targets: ids,
        at: frameSeconds(20, rate),
        duration: 0.5,
        from: { opacity: 1 },
        to: { opacity: 0 },
        ease: 'power2.in',
      },
    ]);
  });

  it('puts a jump half a frame before its frame, and drops one that changes nothing', () => {
    const tweens = trackAnimation(
      'e',
      'opacity',
      { start: 0, end: 90 },
      0,
      [
        { from: 30, to: 30, start: 0, end: 1 },
        { from: 40, to: 40, start: 1, end: 1 },
      ],
      rate,
    );
    expect(tweens).toEqual([
      { targets: ids, at: 0, duration: 0, from: {}, to: { opacity: 0 } },
      { targets: ids, at: jumpSeconds(30, rate), duration: 0, from: {}, to: { opacity: 1 } },
    ]);
    expect(jumpSeconds(30, rate)).toBeCloseTo(29.5 / 30, 12);
    expect(jumpSeconds(0, rate)).toBe(0);
  });

  it('starts at a segment’s own start when it begins on frame 0', () => {
    const tweens = trackAnimation(
      'e',
      'scale',
      { start: 0, end: 30 },
      1,
      [{ from: 0, to: 10, start: 0.85, end: 1 }],
      rate,
    );
    expect(tweens[0]).toEqual({ targets: ids, at: 0, duration: 0, from: {}, to: { scale: 0.85 } });
  });

  it('ends a tween half a frame sooner where the next starts on a different value, never where it continues', () => {
    const tweens = trackAnimation(
      'e',
      'opacity',
      { start: 0, end: 90 },
      1,
      [
        { from: 10, to: 20, start: 1, end: 0 },
        { from: 20, to: 30, start: 0, end: 1 },
        { from: 30, to: 40, start: 0.5, end: 1 },
      ],
      rate,
    );
    const moving = tweens.filter((tween) => tween.duration > 0);
    expect(moving.map((tween) => tween.duration * 30)).toEqual([10, 9.5, 10]);
  });

  it('clamps segments to the window and gives nothing for an empty one', () => {
    expect(
      trackAnimation('e', 'opacity', { start: 5, end: 5 }, 1, [{ from: 0, to: 9, start: 0, end: 1 }], rate),
    ).toEqual([]);
    expect(trackAnimation('e', 'opacity', { start: 0, end: 30 }, 1, [], rate)).toEqual([]);
    const clamped = trackAnimation(
      'e',
      'opacity',
      { start: 10, end: 20 },
      1,
      [{ from: 0, to: 40, start: 0, end: 1 }],
      rate,
    );
    expect(clamped[1]).toMatchObject({ at: frameSeconds(10, rate), duration: frameSeconds(10, rate) });
  });
});

describe('stepAnimation', () => {
  it('is off at 0, on half a frame before its span and off half a frame before its end', () => {
    expect(stepAnimation('e', 'opacity', { start: 0, end: 60 }, 0, 1, { start: 12, end: 18 }, rate)).toEqual([
      { targets: ids, at: 0, duration: 0, from: {}, to: { opacity: 0 } },
      { targets: ids, at: jumpSeconds(12, rate), duration: 0, from: {}, to: { opacity: 1 } },
      { targets: ids, at: jumpSeconds(18, rate), duration: 0, from: {}, to: { opacity: 0 } },
    ]);
  });
});
