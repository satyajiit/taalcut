// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** BRK1-ACC: the doubts the breakdown writes for the review, from made-up evidence. */
import { describe, expect, it } from 'vitest';
import { FrameRate, RationalTime, type BeatMap } from '@taalcut/core';
import { BREAKDOWN_CONFIG } from '../src/breakdown/config';
import { isVague, reelDoubts, slotDoubts, tempoDoubt } from '../src/breakdown/doubts';
import { intent } from './helpers/fixtures';

const ms = FrameRate.of(1000);
const envelopeRate = FrameRate.of(50);

function beatMap(bpm: number, count = 16): BeatMap {
  const period = 60_000 / bpm;
  return {
    rate: ms,
    beats: Array.from({ length: count }, (_, k) => RationalTime.of(Math.round(500 + k * period), ms)),
    downbeats: [],
    bpm,
    beatsPerBar: null,
    confidence: 0.9,
    source: 'tracker',
  };
}

/** Onset strength at 50/s: `on` at each beat, `between` halfway, 0.05 elsewhere. */
function envelope(map: BeatMap, on: number, between: number) {
  const peaks = Array.from({ length: 50 * 20 }, () => 0.05);
  const times = map.beats.map((beat) => RationalTime.toSeconds(beat));
  times.forEach((time, k) => {
    peaks[Math.round(time * 50)] = on;
    const next = times[k + 1];
    if (next !== undefined) peaks[Math.round(((time + next) / 2) * 50)] = between;
  });
  return { rate: envelopeRate, peaks };
}

describe('tempoDoubt', () => {
  it('is quiet on a steady map with weak off-beats', () => {
    const map = beatMap(97.3);
    expect(tempoDoubt(map, envelope(map, 1, 0.2), BREAKDOWN_CONFIG)).toBeNull();
  });

  it('asks when the off-beats are as strong as the beats: double time is as likely', () => {
    const map = beatMap(100);
    expect(tempoDoubt(map, envelope(map, 1, 0.9), BREAKDOWN_CONFIG)).toMatchObject({
      reason: 'tempoMaybeHalfOrDouble',
    });
  });

  it('asks at a very fast or very slow tempo, and never without a map', () => {
    expect(tempoDoubt(beatMap(172), null, BREAKDOWN_CONFIG)?.reason).toBe('tempoMaybeHalfOrDouble');
    expect(tempoDoubt(beatMap(64), null, BREAKDOWN_CONFIG)?.reason).toBe('tempoMaybeHalfOrDouble');
    expect(tempoDoubt(null, null, BREAKDOWN_CONFIG)).toBeNull();
  });
});

describe('reelDoubts', () => {
  const base = { tempo: null, speech: false, linked: true, hasAudio: true };

  it('asks for the sound credit of a linked reel with sound the platform didn’t credit', () => {
    expect(reelDoubts({ ...base, sound: null })).toEqual([{ reason: 'soundCreditMissing' }]);
    expect(reelDoubts({ ...base, sound: { title: null, artist: null } })).toEqual([
      { reason: 'soundCreditMissing' },
    ]);
    expect(reelDoubts({ ...base, sound: { title: 'A song', artist: null } })).toEqual([]);
    expect(reelDoubts({ ...base, linked: false, sound: null })).toEqual([]);
    expect(reelDoubts({ ...base, hasAudio: false, sound: null })).toEqual([]);
  });
});

describe('slotDoubts', () => {
  const clear = intent('a person walks away down a street, the camera following behind');
  const slot = {
    first: false,
    cut: { confidence: 0.95 },
    transition: null,
    seconds: 1,
    intent: { ...clear, subject: 'person', motion: 'tracking' as const },
  };

  it('has none for a sure cut and a clear intent', () => {
    expect(slotDoubts(slot, [slot.intent], BREAKDOWN_CONFIG)).toEqual([]);
  });

  it('asks about an unsure cut, a transition that may be one shot and a fade’s short tail', () => {
    const unsure = slotDoubts({ ...slot, cut: { confidence: 0.6 } }, [slot.intent], BREAKDOWN_CONFIG);
    expect(unsure).toEqual([{ reason: 'cutUnsure', confidence: 0.4 }]);
    const whip = { kind: 'whip', confidence: 0.7 };
    expect(slotDoubts({ ...slot, transition: whip }, [slot.intent], BREAKDOWN_CONFIG)).toEqual([
      { reason: 'cutMaybeTransition', confidence: 0.7 },
    ]);
    const fade = { kind: 'fade', confidence: 0.8 };
    expect(slotDoubts({ ...slot, transition: fade, seconds: 0.2 }, [slot.intent], BREAKDOWN_CONFIG)).toEqual([
      { reason: 'fadeTail' },
    ]);
  });

  it('asks about a camera move the breakdown measured but not surely (FRM1-MOT)', () => {
    expect(slotDoubts({ ...slot, motionUnsure: 0.3 }, [slot.intent], BREAKDOWN_CONFIG)).toEqual([
      { reason: 'motionUnsure', confidence: 0.7 },
    ]);
    const vague = { ...slot.intent, subject: null };
    expect(slotDoubts({ ...slot, intent: vague, motionUnsure: 0.45 }, [vague], BREAKDOWN_CONFIG)).toEqual([
      { reason: 'intentVague' },
      { reason: 'motionUnsure', confidence: 0.55 },
    ]);
  });

  it('no longer calls an intent vague for a missing motion: the template measures it', () => {
    const unmoved = { ...slot.intent, motion: null };
    expect(isVague(unmoved, [unmoved], BREAKDOWN_CONFIG)).toBe(false);
  });

  it('never asks about the first slot’s cut', () => {
    expect(
      slotDoubts({ ...slot, first: true, cut: { confidence: 0.6 } }, [slot.intent], BREAKDOWN_CONFIG),
    ).toEqual([]);
  });
});
