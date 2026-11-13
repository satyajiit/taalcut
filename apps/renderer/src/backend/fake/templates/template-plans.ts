// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* eslint-disable lingui/no-unlocalized-strings -- sample model output and on-screen text: data, never translated */

/** The sample reels the fake's templates are built from (template-data.ts turns each into Template v1). */
import type { Template } from '@taalcut/core';

export interface SlotPlan {
  readonly beats: number;
  readonly role: 'hook' | 'body' | 'peak' | 'outro';
  readonly text: string;
  readonly shotType: Template['slots'][number]['intent']['shotType'];
  readonly motion: Template['slots'][number]['intent']['motion'];
  readonly energy: number;
  readonly place?: string;
  readonly people?: number;
}

export interface TemplatePlan {
  readonly n: number;
  readonly name: string;
  readonly platform: 'reels' | 'tiktok' | 'shorts' | null;
  readonly bpm: number | null;
  /** Frames per beat at 30 fps (15 at 120 BPM, 18 at 100 BPM). */
  readonly beatFrames: number;
  readonly scene: number;
  readonly slots: readonly SlotPlan[];
  readonly overlays: readonly { slot: number; text: string; role: Template['text'][number]['role'] }[];
  readonly language: string | null;
}

export const GOLDEN_HOUR: TemplatePlan = {
  n: 1,
  name: 'Golden hour market',
  platform: 'reels',
  bpm: 120,
  beatFrames: 15,
  scene: 0,
  language: 'en',
  slots: [
    {
      beats: 3,
      role: 'hook',
      text: 'Close-up of hands holding chai against the sunset',
      shotType: 'close',
      motion: 'static',
      energy: 0.62,
      place: 'beach stall',
      people: 1,
    },
    {
      beats: 2,
      role: 'body',
      text: 'Wide shot of the beach, people walking at the water’s edge',
      shotType: 'wide',
      motion: 'pan',
      energy: 0.4,
    },
    {
      beats: 2,
      role: 'body',
      text: 'Waves washing over feet, slow motion',
      shotType: 'detail',
      motion: 'static',
      energy: 0.3,
    },
    {
      beats: 2,
      role: 'body',
      text: 'A friend laughing, handheld and close',
      shotType: 'medium',
      motion: 'handheld',
      energy: 0.7,
      people: 1,
    },
    {
      beats: 3,
      role: 'body',
      text: 'Food stall from above, plates being served',
      shotType: 'detail',
      motion: 'tilt',
      energy: 0.5,
    },
    {
      beats: 2,
      role: 'body',
      text: 'Walking through a market lane, first person',
      shotType: 'pov',
      motion: 'tracking',
      energy: 0.65,
    },
    {
      beats: 2,
      role: 'body',
      text: 'Fabric and colours at a stall, slow push-in',
      shotType: 'close',
      motion: 'push-in',
      energy: 0.45,
    },
    {
      beats: 3,
      role: 'peak',
      text: 'Whip to the skyline as the lights come on',
      shotType: 'wide',
      motion: 'pan',
      energy: 0.95,
    },
    {
      beats: 2,
      role: 'peak',
      text: 'Fireworks over the river',
      shotType: 'wide',
      motion: 'static',
      energy: 0.9,
    },
    {
      beats: 3,
      role: 'body',
      text: 'Friends in silhouette against the fireworks',
      shotType: 'medium',
      motion: 'static',
      energy: 0.6,
      people: 3,
    },
    {
      beats: 2,
      role: 'body',
      text: 'The sea at blue hour, slow push-in',
      shotType: 'wide',
      motion: 'push-in',
      energy: 0.25,
    },
    {
      beats: 4,
      role: 'outro',
      text: 'The last of the light, room for a closing line',
      shotType: 'wide',
      motion: 'static',
      energy: 0.2,
    },
  ],
  overlays: [
    { slot: 0, text: 'GOA IN 15 SECONDS', role: 'title' },
    { slot: 4, text: '₹40 CHAI · ₹120 THALI', role: 'label' },
    { slot: 7, text: 'SUNSET MARKET', role: 'label' },
    { slot: 11, text: 'SAVE THIS FOR YOUR TRIP', role: 'cta' },
  ],
};

export const MORNING: TemplatePlan = {
  n: 2,
  name: 'Slow morning routine',
  platform: 'tiktok',
  bpm: 100,
  beatFrames: 18,
  scene: 20,
  language: 'pt-BR',
  slots: [
    {
      beats: 2,
      role: 'hook',
      text: 'Alarm off, hand reaching out of the covers',
      shotType: 'close',
      motion: 'static',
      energy: 0.5,
    },
    {
      beats: 3,
      role: 'body',
      text: 'Pour-over coffee from above, steam rising',
      shotType: 'detail',
      motion: 'static',
      energy: 0.3,
    },
    {
      beats: 2,
      role: 'body',
      text: 'Window light across the desk',
      shotType: 'medium',
      motion: 'pan',
      energy: 0.25,
    },
    {
      beats: 3,
      role: 'body',
      text: 'Laptop open, hands typing',
      shotType: 'close',
      motion: 'handheld',
      energy: 0.4,
    },
    {
      beats: 2,
      role: 'body',
      text: 'Plants watered, slow tilt down',
      shotType: 'medium',
      motion: 'tilt',
      energy: 0.3,
    },
    {
      beats: 3,
      role: 'peak',
      text: 'Out the door, walking towards the camera',
      shotType: 'wide',
      motion: 'tracking',
      energy: 0.8,
    },
    {
      beats: 2,
      role: 'body',
      text: 'Café table, first sip',
      shotType: 'close',
      motion: 'static',
      energy: 0.4,
    },
    {
      beats: 3,
      role: 'outro',
      text: 'Talking to camera: what today is for',
      shotType: 'medium',
      motion: 'static',
      energy: 0.5,
      people: 1,
    },
  ],
  overlays: [
    { slot: 0, text: '6:30 AM', role: 'title' },
    { slot: 7, text: 'SEGUE PRA MAIS', role: 'cta' },
  ],
};

export const HOOK_TEST: TemplatePlan = {
  n: 3,
  name: 'Three-hook vlog opener',
  platform: 'shorts',
  bpm: null,
  beatFrames: 30,
  scene: 8,
  language: 'hi',
  slots: [
    {
      beats: 2,
      role: 'hook',
      text: 'Talking to camera: the question the video answers',
      shotType: 'medium',
      motion: 'static',
      energy: 0.7,
      people: 1,
    },
    {
      beats: 3,
      role: 'body',
      text: 'B-roll of the place, wide',
      shotType: 'wide',
      motion: 'pan',
      energy: 0.4,
    },
    {
      beats: 3,
      role: 'body',
      text: 'Detail that proves the point',
      shotType: 'detail',
      motion: 'push-in',
      energy: 0.5,
    },
    {
      beats: 4,
      role: 'body',
      text: 'Back to camera with the answer',
      shotType: 'medium',
      motion: 'handheld',
      energy: 0.6,
      people: 1,
    },
    {
      beats: 3,
      role: 'outro',
      text: 'Ask a question for the comments',
      shotType: 'close',
      motion: 'static',
      energy: 0.5,
      people: 1,
    },
  ],
  overlays: [{ slot: 0, text: 'क्या आप जानते हैं?', role: 'title' }],
};
