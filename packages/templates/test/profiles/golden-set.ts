// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A three-template synthetic set whose profile was worked out by hand (profile-of.test.ts has the arithmetic).
 * Slot vectors in two dimensions put template 2 between the others, so it is the one exemplar.
 */
import type { StyleProfile, TemplateId } from '@taalcut/core';
import type { SlotVectorSet } from '../../src/profiles/exemplars';
import { syntheticId, syntheticTemplate } from '../../src/profiles/synthetic-set';

export const GOLDEN_INDEX = 'lib_tpl';

export const goldenTemplates = () => [
  syntheticTemplate({
    index: 1,
    shots: [12, 24, 45, 30],
    hookShotType: 'close',
    transitions: [null, 'whip', null],
    ramps: [2],
    texts: [
      {
        slot: 0,
        text: 'POV: you finally',
        y: 0.1,
        size: 0.03,
        reveal: 'pop',
        case: 'upper',
        background: 'box',
      },
      { slot: 2, text: 'Day one in Goa\nhello', y: 0.8, size: 0.05, reveal: 'fade' },
    ],
    audio: { kind: 'music', lufs: -14, peaks: [0.1, 0.2, 0.3, 0.4, 0.5, 0.5, 0.4, 0.3, 0.2, 0.1] },
    cutsOnBeat: 1,
  }),
  syntheticTemplate({
    index: 2,
    shots: [27, 33, 21],
    hookShotType: 'close',
    transitions: ['whip', null],
    texts: [{ slot: 0, text: 'Wait for it', y: 0.4, size: 0.02, reveal: 'pop', role: 'caption' }],
    audio: { kind: 'voice', lufs: -18, peaks: [0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8] },
    cutsOnBeat: 0.5,
  }),
  syntheticTemplate({
    index: 3,
    shots: [60, 18, 36, 30],
    canvas: { width: 1080, height: 1080 },
    hookShotType: 'wide',
    transitions: [null, null, 'dissolve'],
    audio: { kind: 'music', lufs: null },
  }),
];

const id = (n: number) => syntheticId<TemplateId>(1, n);
const vectors = (n: number, x: number, y: number) =>
  Array.from({ length: n }, () => new Float32Array([x, y]));

export const goldenVectors = (): SlotVectorSet[] => [
  { templateId: id(1), vectors: vectors(4, 1, 0) },
  { templateId: id(2), vectors: vectors(3, 0.8, 0.6) },
  { templateId: id(3), vectors: vectors(4, 0, 1) },
];

/** Worked out by hand from the specs above. */
export const GOLDEN_PROFILE: StyleProfile = {
  algorithm: 'style-profile.v1',
  members: 3,
  pacing: {
    shot: { n: 11, q1: 0.75, median: 1, q3: 1.15 },
    cutsOnBeat: 0.8,
    withBeats: 2,
    shotsInFirst3s: { n: 3, q1: 3, median: 3, q3: 3.5 },
  },
  hook: {
    shotType: [
      { value: 'close', count: 2 },
      { value: 'wide', count: 1 },
    ],
    duration: { n: 3, q1: 0.65, median: 0.9, q3: 1.45 },
    withText: 2,
    reveal: [{ value: 'pop', count: 2 }],
    role: [
      { value: 'caption', count: 1 },
      { value: 'title', count: 1 },
    ],
    textExamples: ['Wait for it'],
  },
  mix: {
    transitions: [
      { value: 'cut', count: 5 },
      { value: 'whip', count: 2 },
      { value: 'dissolve', count: 1 },
    ],
    slots: 11,
    speedRamps: 1,
    rampCurves: [{ value: 'ease', count: 1 }],
  },
  overlays: {
    count: 3,
    withText: 2,
    position: [
      { value: 'bottom', count: 1 },
      { value: 'middle', count: 1 },
      { value: 'top', count: 1 },
    ],
    size: [
      { value: 'large', count: 1 },
      { value: 'medium', count: 1 },
      { value: 'small', count: 1 },
    ],
    reveal: [
      { value: 'pop', count: 2 },
      { value: 'fade', count: 1 },
    ],
    case: [
      { value: 'mixed', count: 2 },
      { value: 'upper', count: 1 },
    ],
    background: [
      { value: 'none', count: 2 },
      { value: 'box', count: 1 },
    ],
    wordsPerLine: { n: 4, q1: 2.5, median: 3, q3: 3.25 },
  },
  audio: {
    kind: [
      { value: 'music', count: 2 },
      { value: 'voice', count: 1 },
    ],
    loudnessLufs: -16,
    energy: [0.6, 0.7, 0.8, 0.9, 1, 1, 0.9, 0.8, 0.7, 0.6],
  },
  form: {
    length: { n: 3, q1: 3.2, median: 3.7, q3: 4.25 },
    aspect: [
      { value: '9:16', count: 2 },
      { value: '1:1', count: 1 },
    ],
  },
  exemplars: [{ id: id(2), version: 1 }],
  exemplarPool: 3,
  exemplarIndex: GOLDEN_INDEX,
};
