// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { FrameRate, newId, RationalTime, type SlotId } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { LINE_RATE } from '../../src/voice/alignment';
import { planPlacement, type PlacementLine } from '../../src/voice/placement';
import { makeTestTimeline, steadyBeatMap } from '../helpers/timeline';

const secs = (s: number) => RationalTime.of(Math.round(s * 48_000), LINE_RATE);
const slots = [newId<'TemplateSlot'>(), newId<'TemplateSlot'>(), newId<'TemplateSlot'>()] as SlotId[];

function line(slot: number, speechSeconds: number, onsetSeconds = 0.15): PlacementLine {
  return {
    lineId: newId<'VoiceLine'>(),
    slotId: slots[slot] ?? null,
    assetId: newId<'Asset'>(),
    duration: secs(onsetSeconds + speechSeconds + 0.3),
    onset: secs(onsetSeconds),
    speechEnd: secs(onsetSeconds + speechSeconds),
  };
}

/** Three 4 s slots at `rate`, a 100 BPM beat map shifted 0.27 s so slot starts fall between beats. */
function timeline(rate: FrameRate, beats = true) {
  const fps = rate.num / rate.den;
  const frames = Math.round(4 * fps);
  const map = steadyBeatMap(100, 13);
  const shifted = beats
    ? { ...map, beats: map.beats.map((b) => RationalTime.of(b.value + 270, b.rate)) }
    : null;
  return makeTestTimeline({ rate, clips: slots.map((slotId) => ({ frames, slotId })), beatMap: shifted });
}

describe('planPlacement (P3-B6)', () => {
  for (const rate of [FrameRate.of(24), FrameRate.of(30), FrameRate.of(30000, 1001)])
    it(`puts each onset within one frame of its slot's beat at ${(rate.num / rate.den).toFixed(2)} fps`, () => {
      const tl = timeline(rate);
      const placed = planPlacement(tl, [line(0, 2), line(1, 2.5), line(2, 1.5)]);
      expect(placed.ok).toBe(true);
      if (!placed.ok) return;
      const frameMs = (1000 * rate.den) / rate.num;
      for (const p of placed.value.placements) {
        expect(p.offBeat).toBe(false);
        const beat = tl.beatMap?.beats[p.beatIndex ?? -1];
        const beatMs = beat ? RationalTime.toSeconds(beat) * 1000 : NaN;
        // The onset plays half a frame after the clip starts (the source starts half a frame early).
        expect(Math.abs(p.startFrame * frameMs + frameMs / 2 - beatMs)).toBeLessThanOrEqual(frameMs);
      }
      const [a, b] = placed.value.placements;
      if (a && b) expect(a.startFrame + a.durationFrames).toBeLessThanOrEqual(b.startFrame);
    });

  it('pre-laps one beat when the slot beat leaves too little room', () => {
    const tl = timeline(FrameRate.of(30));
    // 3.75 s of speech from slot 1's first beat (4.47 s) would end past the slot; the voiced next slot allows no spill.
    const placed = planPlacement(tl, [line(0, 3), line(1, 3.75), line(2, 1)]);
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    const second = placed.value.placements[1];
    expect(second && second.startFrame < 120).toBe(true);
    expect(second?.compress).toBe(1);
  });

  it('compresses by at most 8 %, then gives script_too_long with how far over', () => {
    const tl = timeline(FrameRate.of(30), false);
    const squeezed = planPlacement(tl, [line(0, 4.1), line(1, 1), line(2, 1)]);
    expect(squeezed.ok && squeezed.value.placements[0]?.compress).toBeGreaterThanOrEqual(0.92);
    expect(squeezed.ok && (squeezed.value.placements[0]?.compress ?? 1) < 1).toBe(true);
    const tooLong = planPlacement(tl, [line(0, 5.5), line(1, 1), line(2, 1)]);
    expect(tooLong.ok).toBe(false);
    if (tooLong.ok) return;
    expect(tooLong.error.code).toBe('audio.script_too_long');
    expect(Number(tooLong.error.params?.overByMs)).toBeGreaterThan(0);
  });

  it('spills into half of an unvoiced next slot, never past the timeline', () => {
    const tl = timeline(FrameRate.of(30), false);
    const spill = planPlacement(tl, [line(0, 5.5)]);
    expect(spill.ok).toBe(true);
    const end = planPlacement(tl, [line(2, 4.5)]);
    expect(end.ok ? 'ok' : end.error.code).toBe('audio.script_too_long');
  });

  it('starts 120 ms into the slot without a beat map, and never overlaps lines', () => {
    const tl = timeline(FrameRate.of(30), false);
    const placed = planPlacement(tl, [line(0, 3.9), line(1, 1)]);
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    expect(placed.value.placements[0]?.startFrame).toBe(4);
    const [a, b] = placed.value.placements;
    expect(a && b && a.startFrame + a.durationFrames <= b.startFrame).toBe(true);
  });
});
