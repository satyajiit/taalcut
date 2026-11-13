// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { HubStructure } from '@taalcut/core';

const FPS = { num: 30, den: 1 } as const;
const MS = { num: 1000, den: 1 } as const;
const at = (frames: number) => ({ value: frames, rate: FPS });

const slot = (index: number, text: string, shotType: 'wide' | 'close' | 'detail') => ({
  role: index === 0 ? ('hook' as const) : ('body' as const),
  name: null,
  start: at(index * 15),
  duration: at(15),
  intent: {
    text,
    shotType,
    motion: 'push-in' as const,
    subject: null,
    people: null,
    place: null,
    energy: 0.5,
  },
  beatAnchor: { beatIndex: index, offset: at(0) },
  transitionIn: null,
  speedRamp: null,
});

/** Three half-second slots on the beat at 120 BPM, a title over the first. */
export const STRUCTURE: HubStructure = {
  canvas: { width: 1080, height: 1920, rate: FPS },
  duration: at(45),
  slots: [
    slot(0, 'Close-up of hands holding chai', 'close'),
    slot(1, 'Wide shot of the beach', 'wide'),
    slot(2, 'Detail of the cup', 'detail'),
  ],
  beatMap: {
    rate: MS,
    beats: [0, 500, 1000].map((value) => ({ value, rate: MS })),
    downbeats: [0],
    bpm: 120,
    beatsPerBar: 4,
    confidence: 0.9,
    source: 'tracker',
  },
  text: [
    {
      role: 'title',
      start: at(0),
      duration: at(15),
      slotIndex: 0,
      box: { x: 0.08, y: 0.18, width: 0.84, height: 0.08 },
      appearance: { size: 0.035, align: 'center', case: 'upper', background: 'none' },
      styleKey: 'title',
      reveal: 'pop',
      language: 'en',
      placeholder: '{title}',
      words: 3,
      chars: 18,
    },
  ],
  audio: { kind: 'music', loudnessLufs: -9, speechCoverage: null, speechLanguage: null },
  pacing: {
    shotCount: 3,
    meanShot: at(15),
    medianShot: at(15),
    shortestShot: at(15),
    longestShot: at(15),
    hookEnd: at(15),
    cutsOnBeat: 1,
  },
};
