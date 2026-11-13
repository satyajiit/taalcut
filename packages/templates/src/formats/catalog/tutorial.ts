// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { ShotType } from '@taalcut/core';
import { CTA_BOX, STEP_BOX, TITLE_BOX } from '../boxes';
import { defined, defineFormat } from '../format-module';
import { fillCount, hook, one, section, turn } from '../section-builders';

const stepShots = ['detail', 'close', 'screen'] as const satisfies readonly ShotType[];

export const tutorialModule = defined(
  defineFormat({
    id: 'tutorial',
    version: '1.0.0',
    nameKey: 'formats.tutorial.name',
    descriptionKey: 'formats.tutorial.description',
    minSeconds: 6,
    maxSeconds: 120,
    defaultBpm: 100,
    audio: 'voice',
    captions: 'recommended',
    sections: [
      hook('the finished result', {
        text: 'Hook: the finished result first',
        shotType: 'close',
        motion: 'static',
        people: null,
        energy: 0.85,
      }),
      section({
        key: 'intro',
        role: 'body',
        count: one,
        beats: { min: 2, pref: 4, max: 4 },
        label: { text: '{title}', role: 'title', box: TITLE_BOX },
        intent: () => ({
          text: 'Intro: what you need, wide or overhead',
          shotType: 'wide',
          motion: 'static',
          subject: 'what you need',
          people: null,
          energy: 0.4,
        }),
      }),
      section({
        key: 'step',
        role: 'body',
        count: fillCount,
        beats: { min: 2, pref: 6, max: 8 },
        fill: true,
        label: { text: '{step}', role: 'label', box: STEP_BOX, every: true },
        intent: (index) => ({
          text: 'Step: hands or screen',
          shotType: turn(stepShots, index),
          motion: 'static',
          subject: 'the step',
          people: null,
          energy: 0.5,
        }),
      }),
      section({
        key: 'result',
        role: 'body',
        count: one,
        beats: { min: 2, pref: 4, max: 4 },
        intent: () => ({
          text: 'Result: the finished thing',
          shotType: 'close',
          motion: 'static',
          subject: 'the finished thing',
          people: null,
          energy: 0.8,
        }),
      }),
      section({
        key: 'outro',
        role: 'outro',
        count: one,
        beats: { min: 2, pref: 3, max: 4 },
        label: { text: '{cta}', role: 'cta', box: CTA_BOX },
        intent: () => ({
          text: 'Outro: a last look and the ask',
          shotType: 'medium',
          motion: 'static',
          subject: null,
          people: 1,
          energy: 0.4,
        }),
      }),
    ],
  }),
);
