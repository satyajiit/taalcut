// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { CameraMotion, ShotType } from '@taalcut/core';
import { defined, defineFormat, type FormatSection } from '../format-module';
import { fillCount, hook, one, ramp, turn } from '../section-builders';

/** Vlog sections, unchanged from the P2 plan. */
export const VLOG_SECTIONS: readonly FormatSection[] = [
  hook('the most striking moment of the trip'),
  {
    key: 'establishing',
    role: 'body',
    count: one,
    beats: { min: 2, pref: 4, max: 4 },
    label: { text: '{place}', role: 'title' },
    intent: () => ({
      text: 'Establishing shot: wide or aerial view of the place',
      shotType: 'wide',
      motion: 'pan',
      subject: 'the place',
      people: null,
      energy: 0.4,
    }),
  },
  {
    key: 'journey',
    role: 'body',
    count: fillCount,
    beats: 'body',
    fill: true,
    intent: (index, count) => {
      const shot = turn<ShotType>(['medium', 'close', 'detail'], index);
      return {
        text: `Journey: ${shot} shot of the trip, with people`,
        shotType: shot,
        motion: turn<CameraMotion>(['handheld', 'tracking', 'static'], index),
        subject: 'the trip',
        people: shot === 'detail' ? null : 1,
        energy: ramp(0.5, 0.8, index, count),
      };
    },
  },
  {
    key: 'peak',
    role: 'peak',
    count: { min: 1, pref: (seconds) => (seconds >= 30 ? 3 : 2), max: 3 },
    beats: { min: 2, pref: 2, max: 2 },
    intent: (index) => ({
      text: 'Peak: fast, high-energy moment',
      shotType: turn<ShotType>(['close', 'medium'], index),
      motion: 'handheld',
      subject: null,
      people: null,
      energy: 1,
    }),
  },
  {
    key: 'outro',
    role: 'outro',
    count: one,
    beats: { min: 2, pref: 4, max: 6 },
    intent: () => ({
      text: 'Outro: calm wide shot or a face to close',
      shotType: 'wide',
      motion: 'static',
      subject: null,
      people: null,
      energy: 0.3,
    }),
  },
];

export const vlogModule = defined(
  defineFormat({
    id: 'vlog',
    version: '1.0.0',
    nameKey: 'formats.vlog.name',
    descriptionKey: 'formats.vlog.description',
    minSeconds: 6,
    maxSeconds: 120,
    defaultBpm: 120,
    audio: 'music',
    captions: 'optional',
    sections: VLOG_SECTIONS,
  }),
);
