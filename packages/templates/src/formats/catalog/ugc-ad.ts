// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { CTA_BOX, LABEL_BOX } from '../boxes';
import { minShare } from '../constraints/min-share';
import { defined, defineFormat } from '../format-module';
import { fillCount, hook, one, section, turn } from '../section-builders';

export const ugcAdModule = defined(
  defineFormat({
    id: 'ugcAd',
    version: '1.0.0',
    nameKey: 'formats.ugcAd.name',
    descriptionKey: 'formats.ugcAd.description',
    minSeconds: 6,
    maxSeconds: 120,
    defaultBpm: 120,
    audio: 'music',
    captions: 'recommended',
    constraints: [minShare('demo', 0.4)],
    sections: [
      hook('the product', {
        text: 'Hook: the product or a face reacting',
        shotType: 'close',
        motion: 'handheld',
        people: 1,
        energy: 0.95,
      }),
      section({
        key: 'problem',
        role: 'body',
        count: { min: 1, pref: (seconds) => (seconds >= 30 ? 3 : seconds >= 15 ? 2 : 1), max: 3 },
        beats: { min: 2, pref: 3, max: 4 },
        label: { text: '{problem}', role: 'label', box: LABEL_BOX },
        intent: () => ({
          text: 'Problem: a person frustrated',
          shotType: 'close',
          motion: 'static',
          subject: 'a person',
          people: 1,
          energy: 0.5,
        }),
      }),
      section({
        key: 'demo',
        role: 'body',
        count: fillCount,
        beats: { min: 2, pref: 3, max: 4 },
        fill: true,
        intent: (index) => ({
          text: 'Demo: the product in use, hands',
          shotType: turn(['detail', 'close'] as const, index),
          motion: 'handheld',
          subject: 'the product',
          people: 1,
          energy: 0.7,
        }),
      }),
      section({
        key: 'result',
        role: 'body',
        count: { min: 0, pref: () => 2, max: 2 },
        beats: { min: 2, pref: 3, max: 4 },
        optional: true,
        label: { text: '{benefit}', role: 'label', box: LABEL_BOX },
        intent: () => ({
          text: 'Result: the after state, a happy face',
          shotType: 'close',
          motion: 'static',
          subject: 'a happy face',
          people: 1,
          energy: 0.8,
        }),
      }),
      section({
        key: 'cta',
        role: 'body',
        count: one,
        beats: { min: 2, pref: 4, max: 4 },
        labels: [
          { text: '{offer}', role: 'label', box: LABEL_BOX },
          { text: '{cta}', role: 'cta', box: CTA_BOX },
        ],
        intent: () => ({
          text: 'Cta: the product with a face',
          shotType: 'medium',
          motion: 'static',
          subject: 'the product',
          people: 1,
          energy: 0.9,
        }),
      }),
    ],
  }),
);
