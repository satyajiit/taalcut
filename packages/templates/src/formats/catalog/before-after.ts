// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { LABEL_BOX } from '../boxes';
import { pairedCount } from '../constraints/paired-count';
import { defined, defineFormat, type FormatSection } from '../format-module';
import { fillCount, hook, one, section } from '../section-builders';

/** Preferred pair count at 120 BPM: the beats left after a 2-beat hook and a 4-beat outro. */
function pairPref(seconds: number): number {
  const rest = Math.max(0, Math.round(seconds * 2) - 6);
  return Math.max(1, Math.round(rest / 6));
}

export const BEFORE_AFTER_SECTIONS: readonly FormatSection[] = [
  hook('the after', {
    text: 'Hook: a glimpse of the after',
    shotType: 'close',
    motion: 'static',
    people: null,
    energy: 0.9,
  }),
  section({
    key: 'before',
    role: 'body',
    count: fillCount,
    beats: { min: 2, pref: 3, max: 4 },
    fill: true,
    label: { text: '{before}', role: 'label', box: LABEL_BOX },
    intent: (index) => ({
      text: `Before: the subject before, same angle as after ${index + 1}`,
      shotType: 'medium',
      motion: 'static',
      subject: 'the subject',
      people: null,
      energy: 0.35,
    }),
  }),
  section({
    key: 'after',
    role: 'body',
    count: { min: 1, pref: pairPref, max: 40 },
    beats: { min: 2, pref: 3, max: 4 },
    transitionIn: { kind: 'whip' },
    label: { text: '{after}', role: 'label', box: LABEL_BOX },
    intent: (index) => ({
      text: `After: the subject after, from the angle of before ${index + 1}`,
      shotType: 'medium',
      motion: 'static',
      subject: 'the subject',
      people: null,
      energy: 0.8,
    }),
  }),
  section({
    key: 'outro',
    role: 'outro',
    count: one,
    beats: { min: 2, pref: 4, max: 4 },
    intent: () => ({
      text: 'Outro: the finished result, wide',
      shotType: 'wide',
      motion: 'static',
      subject: 'the finished result',
      people: null,
      energy: 0.6,
    }),
  }),
];

export const beforeAfterModule = defined(
  defineFormat({
    id: 'beforeAfter',
    version: '1.0.0',
    nameKey: 'formats.beforeAfter.name',
    descriptionKey: 'formats.beforeAfter.description',
    minSeconds: 6,
    maxSeconds: 120,
    defaultBpm: 120,
    audio: 'music',
    captions: 'optional',
    constraints: [pairedCount('before', 'after')],
    sections: BEFORE_AFTER_SECTIONS,
  }),
);
