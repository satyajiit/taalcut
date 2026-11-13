// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FIX-TRIM: where a slip's `avoid` takes a clip in its shot (casting/slip-point.ts), pure: a made-up 10 s shot from
 * its file's start, steady and flat, and a one-second window.
 */
import { FrameRates } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { CASTING_CONFIG as config } from '../src/casting/config';
import { slipPoint } from '../src/casting/slip-point';
import { slotSpecs } from '../src/casting/slots';
import { makeProfile, unitVector } from './fixtures/library';
import { buildTemplate } from './fixtures/template';

const fps30 = FrameRates.fps30;
const slot = {
  ...slotSpecs(buildTemplate({ rate: fps30, slots: [{ frames: 15 }, { frames: 30 }] }), config)[1]!,
  anchorRel: null,
};
const base = makeProfile({ embedding: unitVector(5), frames: 300, peaks: [] });
const profile = {
  ...base,
  motionCurve: base.motionCurve!.map(() => 0.4),
  sharpnessCurve: base.sharpnessCurve!.map(() => 0.5),
};
const at = (current: number, avoid: readonly ('start' | 'end' | 'face')[], tracked = false) =>
  slipPoint({ profile, slot, canvasRate: fps30, config, current, avoid, person: null, tracked });
const startOf = (choice: ReturnType<typeof at>) => (choice.ok ? choice.point.sourceStart.value : null);

describe('a slip’s part of the shot', () => {
  it('leaves the recording’s first second for the nearest clear part, measured', () => {
    const choice = at(10, ['start']);
    expect(choice.ok && choice.measured).toBe(true);
    expect(startOf(choice)).toBe(30);
  });

  it('either way for both ends, and a step on the person’s word when nothing shows', () => {
    expect(startOf(at(10, ['start', 'end']))).toBe(30);
    const stepped = at(150, ['start']);
    expect(stepped.ok && stepped.measured).toBe(false);
    expect(startOf(stepped)).toBe(180);
    expect(startOf(at(150, ['end']))).toBe(120);
  });

  it('has no room past the shot’s end, and no faces to go by untracked', () => {
    expect(at(270, ['start'])).toEqual({ ok: false, why: 'noRoom' });
    expect(at(150, ['face'])).toEqual({ ok: false, why: 'unknownFaces' });
    expect(at(150, ['face'], true)).toEqual({ ok: false, why: 'noGain' });
  });
});
