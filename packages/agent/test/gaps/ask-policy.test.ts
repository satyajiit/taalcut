// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FIX-ASK: which gaps ask, at which autonomy. A shot with no clip, an unsure opening clip, an unsure clip on a shot
 * with the template's text or graphics, or more than a fifth of the shots unsure: each is a reason. "Ask me at every
 * step" asks about any gap; "Only before render" asks when there is a reason; autopilot never asks.
 */
import { askReasons, asksAt, MANY_UNSURE, shotCount } from '@taalcut/agent';
import { describe, expect, it } from 'vitest';
import { madeUp, sure, unsure, type MadeUpShot } from './ask-made-up';

const weak: MadeUpShot = { state: 'weak', weak: unsure(0.4) };

describe('the ask policy (FIX-ASK)', () => {
  it('finds no reason in one unsure clip of ten that carries nothing and isn’t the opening', () => {
    const timeline = madeUp([...sure(4), weak, ...sure(5)]);
    expect(askReasons([timeline])).toEqual([]);
  });

  it('asks for a shot with no clip, wherever it is', () => {
    expect(askReasons([madeUp([...sure(8), { state: 'empty' }, ...sure(4)])])).toEqual(['empty']);
    expect(askReasons([madeUp([{ state: 'empty' }, ...sure(9)])])).toEqual(['empty']);
  });

  it('asks for an unsure opening clip, and for an unsure clip that carries the text or graphics', () => {
    expect(askReasons([madeUp([weak, ...sure(9)])])).toEqual(['opening']);
    expect(askReasons([madeUp([...sure(3), { ...weak, carries: ['text'] }, ...sure(6)])])).toEqual([
      'carries',
    ]);
    expect(askReasons([madeUp([...sure(3), { ...weak, carries: ['graphics'] }, ...sure(6)])])).toEqual([
      'carries',
    ]);
    // An opening shot that carries the title is the opening reason, once.
    expect(askReasons([madeUp([{ ...weak, carries: ['text'] }, ...sure(9)])])).toEqual(['opening']);
  });

  it('asks when more than a fifth of the shots are unsure, not at a fifth', () => {
    expect(MANY_UNSURE).toBe(0.2);
    expect(askReasons([madeUp([...sure(3), weak, weak, ...sure(5)])])).toEqual([]);
    expect(askReasons([madeUp([...sure(3), weak, weak, weak, ...sure(4)])])).toEqual(['manyUnsure']);
  });

  it("counts the video's shots, not just its gaps, and leaves dropped ones out", () => {
    const timeline = madeUp([...sure(3), weak, { state: 'dropped' }]);
    expect(shotCount(timeline)).toBe(4);
    expect(shotCount({ ...timeline, slotCount: undefined })).toBe(4);
    expect(askReasons([timeline])).toEqual(['manyUnsure']);
  });

  it("the owner's video: 13 shots, 12 clips, an unsure opening and shot 4, shot 9 with nothing", () => {
    const shots: MadeUpShot[] = [weak, ...sure(2), weak, ...sure(4), { state: 'empty' }, ...sure(4)];
    expect(askReasons([madeUp(shots)])).toEqual(['empty', 'opening']);
  });

  it('gathers the reasons of every timeline, in one order', () => {
    const a = madeUp([...sure(4), { ...weak, carries: ['graphics'] }, ...sure(5)]);
    const b = madeUp([{ state: 'empty' }, ...sure(3)]);
    expect(askReasons([a, b])).toEqual(['empty', 'carries']);
  });

  it('asks at every step about any gap, before render only with a reason, never on autopilot', () => {
    expect(asksAt('every-step', [])).toBe(true);
    expect(asksAt('every-step', ['empty'])).toBe(true);
    expect(asksAt('before-render', [])).toBe(false);
    expect(asksAt('before-render', ['opening'])).toBe(true);
    expect(asksAt('autopilot', ['empty', 'opening', 'carries', 'manyUnsure'])).toBe(false);
  });
});
