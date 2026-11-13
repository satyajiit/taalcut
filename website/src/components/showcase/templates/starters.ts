// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The starters Taalcut ships: 14 in all, 8 in each language, with the app's own English names and lengths
 * (packages/templates/src/starters/catalogue.ts, apps/renderer/src/features/starters/starter-words.ts, and the
 * formats' names from packages/ui/src/templates/kinds.tsx). Six are offered in every language; the rest in one
 * language each (two each in English, Hindi, Spanish and Portuguese). Each starter's slots are its shipped template's
 * own (packages/templates/starters/<id>.json › structure.slots, in seconds at 30 frames a second), and its music beats
 * the count in its beat map: copied here, since the site imports nothing from the app.
 */

export type FormatId =
  | 'vlog'
  | 'dayInTheLife'
  | 'talkingHead'
  | 'podcastClip'
  | 'ugcAd'
  | 'tutorial'
  | 'beforeAfter'
  | 'highlightReel';
export type FormatFamily = 'story' | 'voice' | 'show' | 'reveal';
export type StarterLanguage = 'English' | 'Hindi' | 'Spanish' | 'Portuguese';

export interface Format {
  readonly id: FormatId;
  readonly name: string;
  readonly family: FormatFamily;
}

export interface Starter {
  readonly id: string;
  readonly name: string;
  readonly format: FormatId;
  readonly seconds: number;
  /** Offered in one language only; absent when it is offered in all of them. */
  readonly language?: StarterLanguage;
  /** Its slots' lengths in seconds, in order. */
  readonly slots: readonly number[];
  /** How many music beats its beat map holds. */
  readonly beats: number;
}

/** The eight formats, two to a family. */
export const FORMATS: readonly Format[] = [
  { id: 'vlog', name: 'Vlog', family: 'story' },
  { id: 'dayInTheLife', name: 'Day in the life', family: 'story' },
  { id: 'talkingHead', name: 'Talking to camera', family: 'voice' },
  { id: 'podcastClip', name: 'Podcast clip', family: 'voice' },
  { id: 'ugcAd', name: 'Product ad', family: 'show' },
  { id: 'tutorial', name: 'How-to', family: 'show' },
  { id: 'beforeAfter', name: 'Before and after', family: 'reveal' },
  { id: 'highlightReel', name: 'Highlight reel', family: 'reveal' },
];

/** `n` slots of `s` seconds. */
const run = (n: number, s: number): number[] => Array.from({ length: n }, () => s);

const TRIP = [1, 2, ...run(14, 1.5), ...run(4, 1), 2];
const DAY = [1, ...run(18, 1.5), 2];
const RECIPE = [1.2, 2.4, 4.2, ...run(5, 3.6), 2.4, 1.8];

export const STARTERS: readonly Starter[] = [
  { id: 'weekend-trip', name: 'Weekend trip', format: 'vlog', seconds: 30, slots: TRIP, beats: 60 },
  { id: 'my-day', name: 'My day', format: 'dayInTheLife', seconds: 30, slots: DAY, beats: 60 },
  {
    id: 'quick-tip',
    name: 'Quick tip to camera',
    format: 'talkingHead',
    seconds: 30,
    slots: [1.2, 3.6, 6, 1.8, 5.4, 1.8, 5.4, 3, 1.8],
    beats: 50,
  },
  {
    id: 'product-in-30-seconds',
    name: 'Product in 30 seconds',
    format: 'ugcAd',
    seconds: 30,
    slots: DAY,
    beats: 60,
  },
  {
    id: 'glow-up',
    name: 'Glow-up',
    format: 'beforeAfter',
    seconds: 15,
    slots: [1, ...run(8, 1.5), 2],
    beats: 30,
  },
  {
    id: 'best-moments',
    name: 'Best moments',
    format: 'highlightReel',
    seconds: 15,
    slots: [0.933, 1.4, 1.433, 1.4, 1.4, 1.4, 0.467, 0.467, 0.467, 1.9, 1.867, 1.867],
    beats: 32,
  },
  {
    id: 'recipe-in-30-seconds',
    name: 'Recipe in 30 seconds',
    format: 'tutorial',
    seconds: 30,
    language: 'English',
    slots: RECIPE,
    beats: 50,
  },
  {
    id: 'podcast-moment',
    name: 'Podcast moment',
    format: 'podcastClip',
    seconds: 30,
    language: 'English',
    slots: [1.2, 5.4, ...run(4, 4.8), 1.2, 1.2, 1.8],
    beats: 50,
  },
  {
    id: 'festival-vlog',
    name: 'Festival vlog',
    format: 'vlog',
    seconds: 45,
    language: 'Hindi',
    slots: [
      1.1, 2.167, 2.2, 2.167, 2.2, 2.167, 2.167, 2.2, 2.167, 2.2, 2.167, 2.2, 2.167, 2.2, 2.167, 2.2, 2.167,
      2.167, 1.667, 1.067, 1.1, 1.1, 1.9,
    ],
    beats: 83,
  },
  {
    id: 'wedding-highlights',
    name: 'Wedding highlights',
    format: 'highlightReel',
    seconds: 30,
    language: 'Hindi',
    slots: [
      0.933, 1.867, 1.433, 1.4, 1.4, 1.4, 1.4, 1.433, 1.4, 1.4, 1.4, 1.4, 1.4, 1.433, 1.4, 1.4, 0.467, 0.467,
      0.467, 0.467, 1.9, 1.867, 1.867,
    ],
    beats: 64,
  },
  {
    id: 'receta-rapida',
    name: 'Quick recipe',
    format: 'tutorial',
    seconds: 30,
    language: 'Spanish',
    slots: RECIPE,
    beats: 50,
  },
  {
    id: 'golazos',
    name: 'Great goals',
    format: 'highlightReel',
    seconds: 15,
    language: 'Spanish',
    slots: [0.867, 1.267, 1.3, 1.267, 1.3, 1.3, 1.267, 0.433, 0.433, 0.433, 1.7, 1.733, 1.7],
    beats: 35,
  },
  {
    id: 'role-de-fim-de-semana',
    name: 'Weekend outing',
    format: 'vlog',
    seconds: 30,
    language: 'Portuguese',
    slots: TRIP,
    beats: 60,
  },
  {
    id: 'receita-rapida',
    name: 'Quick recipe',
    format: 'tutorial',
    seconds: 30,
    language: 'Portuguese',
    slots: RECIPE,
    beats: 50,
  },
];

export const LANGUAGES: readonly StarterLanguage[] = ['English', 'Hindi', 'Spanish', 'Portuguese'];

/** The starters someone sees in `language`: the ones offered in all, then the ones in theirs. */
export function startersIn(language: StarterLanguage): Starter[] {
  return [...STARTERS.filter((s) => !s.language), ...STARTERS.filter((s) => s.language === language)];
}

/** How many starters someone sees in one language (the fewest any language has). */
export function startersInOneLanguage(): number {
  return Math.min(...LANGUAGES.map((l) => startersIn(l).length));
}

export function formatOf(id: FormatId): Format {
  return FORMATS.find((f) => f.id === id) ?? (FORMATS[0] as Format);
}
