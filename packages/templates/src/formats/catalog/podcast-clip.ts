// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { LOWER_THIRD_BOX, TITLE_BOX } from '../boxes';
import { defined, defineFormat, type FormatSection } from '../format-module';
import { fillCount, hook, one, section } from '../section-builders';

const showHook: FormatSection = {
  ...hook('whoever says it', {
    text: 'Hook: the most quotable moment, a close of whoever says it',
    shotType: 'close',
    motion: 'static',
    people: 1,
    energy: 0.8,
  }),
  label: { text: '{show}', role: 'title', box: TITLE_BOX },
};

export const podcastClipModule = defined(
  defineFormat({
    id: 'podcastClip',
    version: '1.0.0',
    nameKey: 'formats.podcastClip.name',
    descriptionKey: 'formats.podcastClip.description',
    minSeconds: 6,
    maxSeconds: 120,
    defaultBpm: 100,
    audio: 'voice',
    captions: 'required',
    sections: [
      showHook,
      section({
        key: 'speaker',
        role: 'body',
        count: fillCount,
        beats: { min: 2, pref: 9, max: 12 },
        fill: true,
        label: {
          text: '{guest}',
          role: 'label',
          box: LOWER_THIRD_BOX,
          when: (index) => index === 1,
        },
        intent: (index) => {
          const guest = index % 2 === 1;
          return {
            text: guest ? 'Speaker: guest at a microphone' : 'Speaker: host at a microphone',
            shotType: guest ? 'close' : 'medium',
            motion: 'static',
            subject: guest ? 'guest' : 'host',
            people: 1,
            energy: 0.5,
          };
        },
      }),
      section({
        key: 'reaction',
        role: 'body',
        count: { min: 0, pref: (seconds) => (seconds >= 30 ? 2 : seconds >= 15 ? 1 : 0), max: 2 },
        beats: { min: 2, pref: 2, max: 2 },
        optional: true,
        intent: () => ({
          text: 'Reaction: close of the listener',
          shotType: 'close',
          motion: 'static',
          subject: 'the listener',
          people: 1,
          energy: 0.6,
        }),
      }),
      section({
        key: 'outro',
        role: 'outro',
        count: one,
        beats: { min: 2, pref: 3, max: 4 },
        intent: () => ({
          text: 'Outro: two-shot',
          shotType: 'medium',
          motion: 'static',
          subject: null,
          people: 2,
          energy: 0.4,
        }),
      }),
    ],
  }),
);
