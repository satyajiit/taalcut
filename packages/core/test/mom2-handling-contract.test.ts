// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** MOM2: a moment the describer states as the camera being handled: stored on the moment, additive, and marked. */
import { describe, expect, it } from 'vitest';
import {
  HANDLING_MARK,
  handlingDuring,
  momentsInWords,
  shotDescriptionSchema,
  shotMomentsSchema,
  type ShotMoment,
  type ShotProfileMoment,
} from '@taalcut/core';

const description = {
  text: 'People hold up tickets in a hall.',
  objects: ['tickets', 'hall'],
  model: { provider: 'on-device', model: 'qwen3.5-9b', local: true },
} as const;

const moments: ShotMoment[] = [
  { start: 0, end: 144, note: 'Hands hold up tickets and passports in a tiled hall.' },
  { start: 144, end: 240, note: 'An arm covers the lens.', handling: true },
  { start: 240, end: 287, note: 'The floor, with shoes and suitcases.', handling: true },
];

describe('ShotMoment.handling', () => {
  it('is stored on the moment the describer stated it for', () => {
    const parsed = shotDescriptionSchema.safeParse({ ...description, moments });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.moments).toEqual(moments);
    expect(parsed.data?.moments?.map((moment) => moment.handling)).toEqual([undefined, true, true]);
  });

  it('is additive: a row written before MOM2 parses as it did, with no stretch stated as handling', () => {
    const before = moments.map(({ handling: _, ...moment }) => moment);
    const parsed = shotMomentsSchema.safeParse(before);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual(before);
    expect(parsed.data?.some((moment) => 'handling' in moment)).toBe(false);
  });

  it('is present only as true: held on purpose is said by leaving it out', () => {
    expect(
      shotMomentsSchema.safeParse([{ start: 0, end: 10, note: 'A boat.', handling: false }]).success,
    ).toBe(false);
    expect(
      shotMomentsSchema.safeParse([{ start: 0, end: 10, note: 'A boat.', handling: 'yes' }]).success,
    ).toBe(false);
  });

  it('counts the frames of a span that lie in handling stretches', () => {
    expect(handlingDuring(moments, 0, 144)).toBe(0);
    expect(handlingDuring(moments, 100, 200)).toBe(56);
    expect(handlingDuring(moments, 200, 287)).toBe(87);
    expect(handlingDuring(moments, 0, 287)).toBe(143);
    // Outside the shot, and an empty span, hold none.
    expect(handlingDuring(moments, 287, 400)).toBe(0);
    expect(handlingDuring(moments, 250, 250)).toBe(0);
    expect(handlingDuring([], 0, 100)).toBe(0);
  });

  it('is marked after the stretch’s times wherever moments are put in words', () => {
    expect(HANDLING_MARK).toBe('(camera handling)');
    expect(momentsInWords(moments, { fps: 60 })).toBe(
      '0-2.4s: Hands hold up tickets and passports in a tiled hall.; ' +
        '2.4-4s (camera handling): An arm covers the lens.; ' +
        '4-4.8s (camera handling): The floor, with shoes and suitcases.',
    );
    // The mark is not part of the note: a cut note keeps it.
    expect(momentsInWords(moments.slice(1, 2), { fps: 60, chars: 8 })).toBe(
      '2.4-4s (camera handling): An arm…',
    );
  });

  it('rides on the profile’s moments', () => {
    const moment: ShotProfileMoment = {
      start: 0,
      end: 10,
      note: 'An arm covers the lens.',
      vector: null,
      handling: true,
    };
    expect(handlingDuring([moment], 0, 10)).toBe(10);
  });
});
