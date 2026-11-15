// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LONG1 contract: a timeline may say where the reel's own music plays bars again (`mix.musicRepeats`), and
 * `timeline.lengthenSlot` writes one. The field is an addition: a timeline stored before LONG1 parses to the same
 * document, with nothing added, and the schema version stays 2.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MIX,
  FrameRates,
  LENGTHEN_FOOTAGE,
  LENGTHEN_SLOT_COMMAND,
  lengthenSlotPayloadSchema,
  lengthenSlotResultSchema,
  MAX_MUSIC_REPEATS,
  musicRepeatSchema,
  musicRepeatsSchema,
  newId,
  RationalTime,
  TIMELINE_SCHEMA_VERSION,
  timelineMixSchema,
  timelineSchema,
  type MusicRepeat,
  type Timeline,
} from '@taalcut/core';
import { json, ntscTimeline } from './helpers/documents';

const fps30 = FrameRates.fps30;
const samples = { num: 48_000, den: 1 };
/** Two bars of 129 frames, played again from the bar line at 6.361 s, as the owner's reel was carried by hand. */
const twoBars: MusicRepeat = {
  at: RationalTime.of(305_328, samples),
  length: RationalTime.of(129, fps30),
  crossfade: RationalTime.of(2_400, samples),
  bars: 2,
  slotId: newId<'TemplateSlot'>(),
};

describe('where the reel’s music plays bars again (LONG1)', () => {
  it('states where it goes back, by how many whole frames, the crossfade and the bars', () => {
    expect(musicRepeatSchema.parse(json(twoBars))).toEqual(twoBars);
    expect(musicRepeatSchema.parse(json({ ...twoBars, slotId: null })).slotId).toBeNull();
    for (const bad of [
      { ...twoBars, bars: 0 },
      { ...twoBars, bars: 1.5 },
      { ...twoBars, length: RationalTime.of(0, fps30) },
      { ...twoBars, at: RationalTime.of(0, samples) },
      { ...twoBars, crossfade: RationalTime.of(-1, samples) },
      { at: twoBars.at, length: twoBars.length },
    ])
      expect(musicRepeatSchema.safeParse(json(bad)).success, JSON.stringify(bad)).toBe(false);
  });

  it('keeps a timeline’s repeats in order, each with the music it plays again inside the reel', () => {
    const later = { ...twoBars, at: RationalTime.of(800_000, samples) };
    expect(musicRepeatsSchema.safeParse(json([twoBars, later])).success).toBe(true);
    expect(musicRepeatsSchema.safeParse(json([later, twoBars])).success).toBe(false);
    // 4.3 s back from 4 s is before the reel's first sample; so is 4.3 s back with a crossfade from 4.32 s.
    expect(
      musicRepeatsSchema.safeParse(json([{ ...twoBars, at: RationalTime.of(192_000, samples) }])).success,
    ).toBe(false);
    expect(
      musicRepeatsSchema.safeParse(json([{ ...twoBars, at: RationalTime.of(207_360, samples) }])).success,
    ).toBe(false);
    // The second goes back two lengths in all: 8.6 s from 8.5 s is before the first sample.
    const tooEarly = { ...twoBars, at: RationalTime.of(408_000, samples) };
    expect(musicRepeatsSchema.safeParse(json([twoBars, tooEarly])).success).toBe(false);
    const many = Array.from({ length: MAX_MUSIC_REPEATS + 1 }, (_, index) => ({
      ...twoBars,
      at: RationalTime.of((index + 1) * 480_000, samples),
    }));
    expect(musicRepeatsSchema.safeParse(json(many)).success).toBe(false);
  });

  it('is on the mix, and a timeline with it parses and serialises unchanged', () => {
    const timeline: Timeline = { ...ntscTimeline(), mix: { ...DEFAULT_MIX, musicRepeats: [] } };
    expect(timelineSchema.parse(json(timeline)).mix.musicRepeats).toEqual([]);
    expect(timelineMixSchema.parse(json({ ...DEFAULT_MIX, musicRepeats: [twoBars] })).musicRepeats).toEqual([
      twoBars,
    ]);
    expect(
      timelineMixSchema.safeParse(json({ ...DEFAULT_MIX, musicRepeats: [{ ...twoBars, bars: 0 }] })).success,
    ).toBe(false);
  });

  it('a timeline stored before LONG1 reads as it was: no version bump, no field added', () => {
    const stored = json(ntscTimeline()) as Timeline;
    expect(TIMELINE_SCHEMA_VERSION).toBe(2);
    expect('musicRepeats' in stored.mix).toBe(false);
    const parsed = timelineSchema.parse(stored);
    expect(json(parsed)).toEqual(stored);
    expect('musicRepeats' in parsed.mix).toBe(false);
    expect('musicRepeats' in DEFAULT_MIX).toBe(false);
  });

  it('timeline.lengthenSlot takes the clip, the frames, the bars, where the music goes back and the footage’s side', () => {
    expect(LENGTHEN_SLOT_COMMAND).toBe('timeline.lengthenSlot');
    expect(LENGTHEN_FOOTAGE).toEqual(['before', 'after']);
    const payload = {
      projectId: newId<'Project'>(),
      timelineId: newId<'Timeline'>(),
      clipId: newId<'TimelineItem'>(),
      frames: 129,
      bars: 2,
      at: twoBars.at,
      crossfade: twoBars.crossfade,
      footage: 'before',
    };
    expect(lengthenSlotPayloadSchema.parse(json(payload))).toEqual(payload);
    expect(lengthenSlotPayloadSchema.parse(json({ ...payload, revision: 4 })).revision).toBe(4);
    for (const bad of [
      { ...payload, frames: 0 },
      { ...payload, frames: 12.5 },
      { ...payload, bars: 0 },
      { ...payload, footage: 'both' },
      { ...payload, clipId: 'clip 1' },
    ])
      expect(lengthenSlotPayloadSchema.safeParse(json(bad)).success, JSON.stringify(bad)).toBe(false);
    const result = {
      timelineId: payload.timelineId,
      revision: 5,
      affectedItemIds: [payload.clipId],
      frames: 129,
    };
    expect(lengthenSlotResultSchema.parse(json(result))).toEqual(result);
  });
});
