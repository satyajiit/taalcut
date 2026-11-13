// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { CameraMotion, ShotType } from '@taalcut/core';
import { defined, defineFormat, type FormatSection } from '../format-module';
import { fillCount, hook, one, part, ramp, turn } from '../section-builders';

/** Day in the life sections, unchanged from the P2 plan. */
export const DAY_IN_THE_LIFE_SECTIONS: readonly FormatSection[] = [
  hook('the best moment of the day'),
  part('morning', { min: 1, pref: (seconds) => (seconds >= 30 ? 3 : 2), max: 3 }, (index, count) => ({
    text: 'Morning: close and detail shots (coffee, getting ready)',
    shotType: turn<ShotType>(['close', 'detail'], index),
    motion: 'static',
    subject: turn(['coffee', 'getting ready'], index),
    people: null,
    energy: ramp(0.3, 0.4, index, count),
  })),
  part(
    'out',
    one,
    () => ({
      text: 'Heading out: wide shot of the commute or the street',
      shotType: 'wide',
      motion: 'tracking',
      subject: 'the commute',
      people: null,
      energy: 0.5,
    }),
    true,
  ),
  {
    ...part('day', fillCount, (index, count) => ({
      text: 'The day: medium and close shots of the main activity',
      shotType: turn<ShotType>(['medium', 'close'], index),
      motion: turn<CameraMotion>(['handheld', 'static'], index),
      subject: 'the activity',
      people: 1,
      energy: ramp(0.6, 0.8, index, count),
    })),
    fill: true,
  },
  part(
    'goldenHour',
    one,
    () => ({
      text: 'Golden hour: wide shot in warm evening light',
      shotType: 'wide',
      motion: 'pan',
      subject: 'golden hour',
      people: null,
      energy: 0.6,
    }),
    true,
  ),
  part('evening', { min: 1, pref: (seconds) => (seconds >= 30 ? 2 : 1), max: 2 }, () => ({
    text: 'Evening: close, calm shot',
    shotType: 'close',
    motion: 'static',
    subject: 'the evening',
    people: null,
    energy: 0.3,
  })),
  {
    key: 'outro',
    role: 'outro',
    count: one,
    beats: { min: 2, pref: 4, max: 6 },
    intent: () => ({
      text: 'Outro: wind-down to close the day',
      shotType: 'medium',
      motion: 'static',
      subject: null,
      people: null,
      energy: 0.2,
    }),
  },
];

export const dayInTheLifeModule = defined(
  defineFormat({
    id: 'dayInTheLife',
    version: '1.0.0',
    nameKey: 'formats.dayInTheLife.name',
    descriptionKey: 'formats.dayInTheLife.description',
    minSeconds: 6,
    maxSeconds: 120,
    defaultBpm: 120,
    audio: 'music',
    captions: 'optional',
    sections: DAY_IN_THE_LIFE_SECTIONS,
  }),
);
