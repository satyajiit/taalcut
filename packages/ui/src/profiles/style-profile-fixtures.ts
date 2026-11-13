// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* eslint-disable lingui/no-unlocalized-strings -- sample model output, reel names and OCR: data, never translated */

import type {
  CardOf,
  Id,
  RunId,
  StyleExemplar,
  StyleProfile,
  StyleProfileSummary,
  StyleProfileView,
  TemplateId,
} from '@taalcut/core';

/**
 * A Saved collection's style profile in each state worth seeing (LRN1-STY), and a folder of one template: the ui
 * tests, the renderer's fake and the chat card's fixtures use them. The numbers are a quick-cut travel set, made up
 * and consistent with each other.
 */
const FPS = { num: 30, den: 1 } as const;
const AT = 1_767_225_600_000;

export const STYLE_PROFILE_SAMPLE: StyleProfile = {
  algorithm: 'style-profile.v1',
  members: 6,
  pacing: {
    shot: { n: 58, q1: 0.8, median: 1.2, q3: 1.733 },
    cutsOnBeat: 0.72,
    withBeats: 5,
    shotsInFirst3s: { n: 6, q1: 2.25, median: 3, q3: 3 },
  },
  hook: {
    shotType: [
      { value: 'close', count: 3 },
      { value: 'wide', count: 2 },
      { value: 'unknown', count: 1 },
    ],
    duration: { n: 6, q1: 0.85, median: 1, q3: 1.4 },
    withText: 5,
    reveal: [
      { value: 'pop', count: 3 },
      { value: 'fade', count: 2 },
    ],
    role: [
      { value: 'title', count: 4 },
      { value: 'caption', count: 1 },
    ],
    textExamples: ['3 cafés you can’t miss', 'POV: Sunday in Lisbon'],
  },
  mix: {
    transitions: [
      { value: 'cut', count: 40 },
      { value: 'whip', count: 8 },
      { value: 'flash', count: 4 },
    ],
    slots: 58,
    speedRamps: 6,
    rampCurves: [
      { value: 'ease', count: 4 },
      { value: 'linear', count: 2 },
    ],
  },
  overlays: {
    count: 14,
    withText: 5,
    position: [
      { value: 'top', count: 8 },
      { value: 'bottom', count: 6 },
    ],
    size: [
      { value: 'large', count: 9 },
      { value: 'medium', count: 5 },
    ],
    reveal: [
      { value: 'pop', count: 8 },
      { value: 'fade', count: 6 },
    ],
    case: [
      { value: 'upper', count: 9 },
      { value: 'mixed', count: 5 },
    ],
    background: [
      { value: 'none', count: 10 },
      { value: 'box', count: 4 },
    ],
    wordsPerLine: { n: 20, q1: 2, median: 3, q3: 4 },
  },
  audio: {
    kind: [
      { value: 'music', count: 5 },
      { value: 'mixed', count: 1 },
    ],
    loudnessLufs: -9.4,
    energy: [0.62, 0.7, 0.81, 0.77, 0.84, 0.9, 0.86, 0.8, 0.74, 0.58],
  },
  form: {
    length: { n: 6, q1: 9.5, median: 11.2, q3: 14.8 },
    aspect: [{ value: '9:16', count: 6 }],
  },
  exemplars: [
    { id: '01K7C5M6Q8R9S0T1V2W3X4Y5E1' as TemplateId, version: 1 },
    { id: '01K7C5M6Q8R9S0T1V2W3X4Y5E2' as TemplateId, version: 2 },
    { id: '01K7C5M6Q8R9S0T1V2W3X4Y5E3' as TemplateId, version: 1 },
  ],
  exemplarPool: 6,
  exemplarIndex: 'templates.slot-intent.v1',
};

const exemplar = (n: 1 | 2 | 3, name: string, frames: number, slotCount: number): StyleExemplar => ({
  templateId: `01K7C5M6Q8R9S0T1V2W3X4Y5E${n}` as TemplateId,
  version: n === 2 ? 2 : 1,
  name,
  contactSheet:
    n === 3
      ? null
      : {
          asset: String(n).repeat(64),
          mediaType: 'image/jpeg',
          columns: 4,
          rows: 3,
          tile: { width: 90, height: 160 },
        },
  duration: { value: frames, rate: FPS },
  slotCount,
});

export const STYLE_PROFILE_EXEMPLARS: StyleExemplar[] = [
  exemplar(1, 'Golden hour in Lisbon', 336, 10),
  exemplar(2, 'Three cafés, one morning', 300, 9),
  exemplar(3, 'Tram 28 at dawn', 354, 11),
];

const view = (summary: StyleProfileSummary, extra: Partial<StyleProfileView> = {}): StyleProfileView => ({
  source: { kind: 'instagram-collection', collectionId: 'col_inspo' },
  name: 'Travel inspo',
  profile: STYLE_PROFILE_SAMPLE,
  summary,
  exemplars: STYLE_PROFILE_EXEMPLARS,
  builtAt: AT,
  ...extra,
});

/** Model output as a local vision model writes it: plain text, at most a paragraph. */
export const STYLE_SUMMARY_SAMPLE =
  'Fast, sunlit travel reels: a close-up opens each one with a bold title at the top, then shots of about a second ' +
  'cut on the beat over upbeat music, with a whip now and then between places.';

const ON_DEVICE: StyleProfileSummary = {
  state: 'written',
  text: STYLE_SUMMARY_SAMPLE,
  provider: 'on-device',
  model: 'qwen3.5-4b',
  local: true,
  at: AT,
};

export const STYLE_PROFILE_FIXTURES = {
  local: view(ON_DEVICE),
  cloud: view({
    state: 'written',
    text: STYLE_SUMMARY_SAMPLE,
    provider: 'google',
    model: 'gemini-3.1-flash-lite',
    local: false,
    at: AT,
  }),
  writing: view({ state: 'writing', at: AT }),
  noModel: view({ state: 'none', reason: 'no_model', at: AT }),
  notYet: view({ state: 'none', reason: 'not_yet', at: AT }),
  failed: view({
    state: 'failed',
    error: {
      code: 'templates.style_summary_empty',
      messageKey: 'errors.templates.style_summary_empty',
      params: { model: 'qwen3.5-4b' },
      retryable: true,
    },
    at: AT,
  }),
  empty: view(
    { state: 'none', reason: 'empty', at: AT },
    {
      source: { kind: 'instagram-collection', collectionId: 'col_hooks' },
      name: 'Hooks',
      profile: null,
      exemplars: [],
      builtAt: null,
    },
  ),
  /** A folder of one template: its own numbers, nothing to compare with yet. */
  one: view(ON_DEVICE, {
    source: { kind: 'folder', folderId: '01K7C5M6Q8R9S0T1V2W3X4Y5F1' as Id<'TemplateFolder'> },
    name: 'Travel',
    profile: {
      ...STYLE_PROFILE_SAMPLE,
      members: 1,
      exemplars: STYLE_PROFILE_SAMPLE.exemplars.slice(0, 1),
      exemplarPool: 1,
    },
    exemplars: STYLE_PROFILE_EXEMPLARS.slice(0, 1),
  }),
} as const satisfies Readonly<Record<string, StyleProfileView>>;

/** templates.styleProfile's card (Part B) in the states worth seeing; fixtures.ts spreads it into CARD_FIXTURES. */
const RUN = '01K7C5M6Q8R9S0T1V2W3X4Y5Z8' as RunId;
const card = (name: string, view: StyleProfileView): CardOf<'styleProfile'> => ({
  type: 'styleProfile',
  id: `style-profile-${name}`,
  version: 1,
  runId: RUN,
  view,
});

export const STYLE_PROFILE_CARD_FIXTURES = {
  local: card('local', STYLE_PROFILE_FIXTURES.local),
  cloud: card('cloud', STYLE_PROFILE_FIXTURES.cloud),
  noModel: card('noModel', STYLE_PROFILE_FIXTURES.noModel),
  empty: card('empty', STYLE_PROFILE_FIXTURES.empty),
} as const satisfies Readonly<Record<string, CardOf<'styleProfile'>>>;
