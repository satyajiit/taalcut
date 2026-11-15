// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** MOM1: a shot's moments (time-ranged notes), the profile's, their vector kind and the slot check on the part used. */
import { describe, expect, it } from 'vitest';
import {
  EMBEDDING_ITEM_KINDS,
  momentsDuring,
  momentsInWords,
  QA_CHECK_IDS,
  qaCheckIdSchema,
  SHOT_MOMENT_LIMITS,
  shotAnalysisSchema,
  shotDescriptionSchema,
  shotMomentsSchema,
  SLOT_MATCH_CHECK_IDS,
  type ShotMoment,
  type ShotProfile,
} from '@taalcut/core';

const description = {
  text: 'People hold up tickets in a hall, then the camera tilts down to the floor.',
  objects: ['tickets', 'hall'],
  model: { provider: 'on-device', model: 'qwen3.5-4b', local: true },
} as const;

const moments: ShotMoment[] = [
  { start: 0, end: 168, note: 'Hands hold up tickets and passports in a tiled hall.' },
  { start: 168, end: 240, note: 'The camera tilts down, blurred.' },
  { start: 240, end: 287, note: 'The floor, with shoes and suitcases.' },
];

describe('ShotDescription.moments', () => {
  it('stores consecutive stretches with their notes, inside an analysis too', () => {
    const parsed = shotDescriptionSchema.safeParse({ ...description, moments });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.moments).toEqual(moments);
    const analysis = {
      version: 1,
      range: {
        start: { value: 0, rate: { num: 60, den: 1 } },
        duration: { value: 287, rate: { num: 60, den: 1 } },
      },
      bestFrame: 0,
      orientation: 'portrait',
      quality: { version: 1, sharpness: 0.9, exposure: 0.9, stability: 0.7, overall: 0.85, flags: [] },
      energy: 0.6,
      onScreenText: [],
      dHash: '0123456789abcdef',
      description: { ...description, moments },
    };
    expect(shotAnalysisSchema.parse(analysis).description?.moments).toHaveLength(3);
  });

  it('is optional: a description stored before MOM1 still parses', () => {
    const parsed = shotDescriptionSchema.safeParse(description);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.moments).toBeUndefined();
  });

  it('refuses gaps, overlaps, empty stretches, empty or overlong notes and more than the cap', () => {
    const bad: ShotMoment[][] = [
      [moments[0]!, { start: 170, end: 240, note: 'A gap before it.' }],
      [moments[0]!, { start: 100, end: 240, note: 'It overlaps.' }],
      [{ start: 5, end: 5, note: 'No length.' }],
      [{ start: 0, end: 10, note: '' }],
      [{ start: 0, end: 10, note: 'x'.repeat(SHOT_MOMENT_LIMITS.chars + 1) }],
      Array.from({ length: SHOT_MOMENT_LIMITS.count + 1 }, (_, n) => ({
        start: n,
        end: n + 1,
        note: 'one frame',
      })),
      [],
    ];
    for (const list of bad) expect(shotMomentsSchema.safeParse(list).success).toBe(false);
    expect(shotMomentsSchema.safeParse(moments).success).toBe(true);
  });
});

describe('reading moments', () => {
  it('finds the stretches a used range overlaps', () => {
    expect(momentsDuring(moments, 241, 255)).toEqual([moments[2]]);
    expect(momentsDuring(moments, 160, 250)).toEqual(moments);
    // A range ending where a stretch starts doesn't touch it.
    expect(momentsDuring(moments, 100, 168)).toEqual([moments[0]]);
  });

  it('writes them as one line with times in seconds of the recording', () => {
    expect(momentsInWords(moments, { fps: 60 })).toBe(
      '0-2.8s: Hands hold up tickets and passports in a tiled hall.; 2.8-4s: The camera tilts down, blurred.; ' +
        '4-4.8s: The floor, with shoes and suitcases.',
    );
    // A shot that starts 10 s into its file reads on the file's clock; long lists and notes are cut.
    expect(momentsInWords(moments, { fps: 60, offsetSeconds: 10, count: 2, chars: 12 })).toBe(
      '10-12.8s: Hands hold…; 12.8-14s: The camera…; +1 more',
    );
    expect(momentsInWords([], { fps: 30 })).toBe('');
  });
});

describe('MOM1 contract', () => {
  it('gives a shot profile its moments, each with a vector once embedded', () => {
    const profile: Pick<ShotProfile, 'moments'> = {
      moments: [{ start: 0, end: 168, note: moments[0]!.note, vector: new Float32Array([1, 0]) }],
    };
    expect(profile.moments?.[0]?.vector).toHaveLength(2);
  });

  it('adds the moment vector kind after the earlier kinds', () => {
    expect(EMBEDDING_ITEM_KINDS).toEqual(['frame', 'transcript', 'ocr', 'description', 'moment']);
  });

  it('adds slotPart after every earlier check, so no id moves, and among the slot checks', () => {
    expect(QA_CHECK_IDS.slice(41)).toEqual(['slotPart']);
    expect(QA_CHECK_IDS.indexOf('soundCritique')).toBe(40);
    expect(SLOT_MATCH_CHECK_IDS.at(-1)).toBe('slotPart');
    expect(SLOT_MATCH_CHECK_IDS).toHaveLength(7);
    expect(qaCheckIdSchema.parse('slotPart')).toBe('slotPart');
  });
});
