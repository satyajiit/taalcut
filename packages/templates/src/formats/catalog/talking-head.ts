// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { CTA_BOX, LABEL_BOX, LOWER_THIRD_BOX } from '../boxes';
import { defined, defineFormat } from '../format-module';
import { fillCount, hook, one, section } from '../section-builders';

const face = { motion: 'static' as const, subject: 'the speaker', people: 1 };

const cutaway = section({
  key: 'cutaway',
  role: 'body',
  count: fillCount,
  beats: { min: 2, pref: 3, max: 4 },
  intent: () => ({
    text: 'Cutaway: detail that shows what is said',
    shotType: 'detail',
    motion: 'static',
    subject: 'what is said',
    people: null,
    energy: 0.6,
  }),
});

/** Speaker points run long (pref 9, inside 6–12). Min 2 so a 6 s grid can still plan. */
export const talkingHeadModule = defined(
  defineFormat({
    id: 'talkingHead',
    version: '1.0.0',
    nameKey: 'formats.talkingHead.name',
    descriptionKey: 'formats.talkingHead.description',
    minSeconds: 6,
    maxSeconds: 120,
    defaultBpm: 100,
    audio: 'voice',
    captions: 'required',
    sections: [
      hook('the speaker', {
        text: 'Hook: close-up of the speaker on their strongest line, eyes to camera',
        shotType: 'close',
        motion: 'static',
        people: 1,
        energy: 0.8,
      }),
      section({
        key: 'intro',
        role: 'body',
        count: one,
        beats: { min: 2, pref: 6, max: 8 },
        label: { text: '{name}', role: 'label', box: LOWER_THIRD_BOX },
        intent: () => ({
          text: 'Intro: medium shot of the speaker',
          shotType: 'medium',
          ...face,
          energy: 0.5,
        }),
      }),
      section({
        key: 'point',
        role: 'body',
        count: fillCount,
        beats: { min: 2, pref: 9, max: 12 },
        fill: true,
        between: cutaway,
        label: { text: '{point}', role: 'label', box: LABEL_BOX, every: true },
        intent: (index) => ({
          text: 'Point: the speaker makes a point',
          shotType: index % 2 === 0 ? 'medium' : 'close',
          ...face,
          energy: index % 2 === 0 ? 0.5 : 0.6,
        }),
      }),
      section({
        key: 'cta',
        role: 'body',
        count: one,
        beats: { min: 2, pref: 5, max: 6 },
        label: { text: '{cta}', role: 'cta', box: CTA_BOX },
        intent: () => ({ text: 'Cta: close shot of the speaker', shotType: 'close', ...face, energy: 0.7 }),
      }),
      section({
        key: 'outro',
        role: 'outro',
        count: one,
        beats: { min: 2, pref: 3, max: 4 },
        intent: () => ({ text: 'Outro: the speaker closes', shotType: 'medium', ...face, energy: 0.4 }),
      }),
    ],
  }),
);
