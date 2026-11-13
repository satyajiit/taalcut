// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The synthetic template evals' world (LRN1-TPL): six themes, each a four-slot template written the way the Analyst
 * writes intents and four clips described the way vision describes footage, plus two templates that mix two themes.
 * A theme's clips were "shot for" its template: that is the label, by construction. Search queries (template-search)
 * are written from the same words.
 */
import type { CameraMotion } from '@taalcut/core';

export interface ThemeSlot {
  readonly intent: string;
  readonly frames: number;
  readonly motion: CameraMotion;
}

export interface ThemeClip {
  readonly description: string;
  readonly motion: CameraMotion;
  readonly faces: number;
}

export interface Theme {
  readonly key: string;
  /** The template's name (what the person called it). */
  readonly name: string;
  readonly tags: readonly string[];
  /** lavfi colour of the theme's clips. */
  readonly color: string;
  readonly slots: readonly ThemeSlot[];
  readonly clips: readonly ThemeClip[];
}

const slot = (intent: string, frames: number, motion: CameraMotion = 'static'): ThemeSlot => ({
  intent,
  frames,
  motion,
});
const clip = (description: string, motion: CameraMotion = 'static', faces = 0): ThemeClip => ({
  description,
  motion,
  faces,
});

export const THEMES: readonly Theme[] = [
  {
    key: 'beach',
    name: 'Beach day',
    tags: ['travel'],
    color: 'blue',
    slots: [
      slot('wide shot of the beach and the waves', 15, 'pan'),
      slot('close up of feet walking in the sand', 12),
      slot('slow pan across the sea at sunset', 15, 'pan'),
      slot('detail of a shell lying in the sand', 10),
    ],
    clips: [
      clip('wide shot of a beach with waves rolling in, slow pan', 'pan'),
      clip('close up of bare feet walking in wet sand'),
      clip('the sea at sunset, the camera pans slowly', 'pan'),
      clip('detail of a white shell in the sand'),
    ],
  },
  {
    key: 'coffee',
    name: 'Morning brew',
    tags: ['routine'],
    color: 'brown',
    slots: [
      slot('close up of coffee pouring into a cup', 12),
      slot('wide shot of a sunny kitchen in the morning', 15),
      slot('detail of steam rising from the mug', 10),
      slot('medium shot of a person sipping coffee at the table', 15, 'static'),
    ],
    clips: [
      clip('close up of hot coffee pouring into a white cup'),
      clip('wide shot of a kitchen in morning sun'),
      clip('steam rising from a mug, detail'),
      clip('a person sipping coffee at a wooden table, medium shot', 'static', 1),
    ],
  },
  {
    key: 'gym',
    name: 'Leg day',
    tags: ['fitness'],
    color: 'red',
    slots: [
      slot('medium shot of a heavy squat with a barbell', 15, 'handheld'),
      slot('close up of hands chalking up before a lift', 10),
      slot('wide shot of the gym floor with weights', 15),
      slot('close up of sweat and a deep breath after the set', 12, 'handheld'),
    ],
    clips: [
      clip('a heavy barbell squat in a gym, medium shot, handheld', 'handheld', 1),
      clip('hands rubbing chalk before a lift, close up'),
      clip('wide view of a gym floor full of weights'),
      clip('close up of a sweaty face taking a deep breath', 'handheld', 1),
    ],
  },
  {
    key: 'market',
    name: 'Night market',
    tags: ['food', 'travel'],
    color: 'orange',
    slots: [
      slot('wide shot of market stalls and a busy crowd', 15, 'handheld'),
      slot('close up of street food frying in a pan', 12),
      slot('detail of colourful spices in sacks', 10),
      slot('medium shot of a vendor handing over food', 15),
    ],
    clips: [
      clip('a busy crowd walking past market stalls, wide, handheld', 'handheld', 3),
      clip('street food frying in a hot pan, close up'),
      clip('colourful spices piled in sacks, detail'),
      clip('a vendor hands food to a customer, medium shot', 'static', 2),
    ],
  },
  {
    key: 'city',
    name: 'City lights',
    tags: ['night'],
    color: 'purple',
    slots: [
      slot('wide shot of the city skyline at night', 15, 'static'),
      slot('timelapse of traffic light trails on the road', 15),
      slot('close up of neon signs reflecting in a puddle', 10),
      slot('medium shot walking through a lit street at night', 12, 'handheld'),
    ],
    clips: [
      clip('the city skyline lit up at night, wide'),
      clip('traffic light trails on a road, timelapse'),
      clip('neon signs reflecting in a rain puddle, close up'),
      clip('walking down a lit street at night, handheld', 'handheld'),
    ],
  },
  {
    key: 'hike',
    name: 'Trail run',
    tags: ['outdoors', 'fitness'],
    color: 'green',
    slots: [
      slot('wide shot of a forest trail in the mountains', 15, 'pan'),
      slot('close up of running shoes on a rocky path', 10, 'handheld'),
      slot('aerial view over the trees and the valley', 15, 'pan'),
      slot('medium shot of the runner reaching the summit', 12),
    ],
    clips: [
      clip('a forest trail winding through the mountains, wide pan', 'pan'),
      clip('running shoes landing on a rocky path, close up', 'handheld'),
      clip('aerial view over trees and a green valley', 'pan'),
      clip('a runner reaches the summit and raises arms, medium shot', 'static', 1),
    ],
  },
];

/** Templates that mix two themes, two slots each: footage of both fills them, footage of one only half. */
export const MIXES: readonly {
  readonly key: string;
  readonly name: string;
  readonly from: readonly [string, string];
}[] = [
  { key: 'beach-coffee', name: 'Coffee by the sea', from: ['beach', 'coffee'] },
  { key: 'gym-hike', name: 'Train and run', from: ['gym', 'hike'] },
];

/**
 * Shorter cuts of a theme (the fit set only): some of its slots. Three of the theme's clips fill a three-slot cut
 * completely, while its four-slot template is a slot short; three clips of another theme fill it too, matching worse.
 */
export const CUTS: readonly {
  readonly key: string;
  readonly name: string;
  readonly from: string;
  /** The theme's slots the cut keeps, by index. */
  readonly slots: readonly number[];
}[] = [{ key: 'gym-quick', name: 'Leg day, quick cut', from: 'gym', slots: [1, 2, 3] }];

export function themeOf(key: string): Theme {
  const found = THEMES.find((theme) => theme.key === key);
  if (!found) throw new Error(`no theme ${key}`);
  return found;
}

/** A mix's slots: the first two of each theme's. */
export function mixSlots(from: readonly [string, string]): ThemeSlot[] {
  return from.flatMap((key) => themeOf(key).slots.slice(0, 2));
}

/** A cut's slots: the theme's slots it keeps. */
export function cutSlots(cut: { readonly from: string; readonly slots: readonly number[] }): ThemeSlot[] {
  const { slots } = themeOf(cut.from);
  return cut.slots.flatMap((index) => slots.slice(index, index + 1));
}
