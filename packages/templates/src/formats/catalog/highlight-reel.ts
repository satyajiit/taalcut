// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { TITLE_BOX } from '../boxes';
import { defined, defineFormat } from '../format-module';
import { fillCount, hook, one, ramp, section, turn } from '../section-builders';

export const highlightReelModule = defined(
  defineFormat({
    id: 'highlightReel',
    version: '1.0.0',
    nameKey: 'formats.highlightReel.name',
    descriptionKey: 'formats.highlightReel.description',
    minSeconds: 6,
    maxSeconds: 120,
    defaultBpm: 128,
    audio: 'music',
    captions: 'optional',
    sections: [
      hook('the peak moment', {
        text: 'Hook: the peak moment',
        shotType: 'close',
        motion: 'handheld',
        people: null,
        energy: 1,
      }),
      section({
        key: 'build',
        role: 'body',
        count: fillCount,
        beats: { min: 2, pref: 3, max: 4 },
        fill: true,
        label: { text: '{title}', role: 'title', box: TITLE_BOX },
        intent: (index, count) => ({
          text: 'Build: action',
          shotType: turn(['medium', 'wide'] as const, index),
          motion: turn(['handheld', 'tracking'] as const, index),
          subject: 'the action',
          people: null,
          energy: ramp(0.5, 0.85, index, count),
        }),
      }),
      section({
        key: 'peak',
        role: 'peak',
        count: { min: 3, pref: (seconds) => (seconds >= 60 ? 5 : seconds >= 30 ? 4 : 3), max: 5 },
        beats: { min: 1, pref: 1, max: 2 },
        intent: () => ({
          text: 'Peak: fastest action',
          shotType: 'close',
          motion: 'handheld',
          subject: null,
          people: null,
          energy: 1,
        }),
      }),
      section({
        key: 'slowDown',
        role: 'body',
        count: one,
        beats: { min: 2, pref: 4, max: 4 },
        speedRamp: { from: 1, mid: 0.5, to: 1 },
        intent: () => ({
          text: 'Slow-down: one striking moment in slow motion',
          shotType: 'close',
          motion: 'static',
          subject: 'a striking moment',
          people: null,
          energy: 0.6,
        }),
      }),
      section({
        key: 'finale',
        role: 'body',
        count: one,
        beats: { min: 2, pref: 4, max: 4 },
        intent: () => ({
          text: 'Finale: the best moment',
          shotType: 'close',
          motion: 'handheld',
          subject: 'the best moment',
          people: null,
          energy: 0.9,
        }),
      }),
      section({
        key: 'outro',
        role: 'outro',
        count: one,
        beats: { min: 2, pref: 4, max: 4 },
        intent: () => ({
          text: 'Outro: calm wide',
          shotType: 'wide',
          motion: 'static',
          subject: null,
          people: null,
          energy: 0.3,
        }),
      }),
    ],
  }),
);
