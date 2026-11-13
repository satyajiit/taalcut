// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import type { SlotRole } from './schema';

/**
 * The 8 starter templates an English window offers (6 for every language and 2 of its own; 14 in all), copied from
 * packages/templates/starters/<id>.json (the shipped files) and the app's words (apps/renderer starter-words.ts,
 * template-words.ts). Never imported: the site imports no Taalcut package. Each slot is [start s, end s, part], its
 * part from the file's role (body is Build), so the home's format cards draw each starter's real shape.
 * test/unit/home-content.test.ts reads the JSON files and holds these to them.
 */
export interface StarterFormat {
  readonly id: string;
  readonly name: string;
  /** The format, as the app names it. */
  readonly kind: string;
  readonly seconds: number;
  /** The footage it needs (StarterNeed), and the app's words for it. */
  readonly need: 'many-clips' | 'day-clips' | 'talking' | 'product' | 'two-clips' | 'steps' | 'conversation';
  readonly needs: string;
  /** Music beats inside its length. */
  readonly beats: number;
  readonly slots: readonly (readonly [start: number, end: number, part: SlotRole])[];
}

/** Starters in every language and in English, in the catalogue's order. */
export const STARTER_TOTAL = 14;

export const STARTER_FORMATS: readonly StarterFormat[] = [
  {
    id: 'weekend-trip',
    name: 'Weekend trip',
    kind: 'Vlog',
    seconds: 30,
    need: 'many-clips',
    needs: 'Lots of short clips',
    beats: 60,
    slots: [[0, 1, 'hook'], [1, 3, 'build'], [3, 4.5, 'build'], [4.5, 6, 'build'], [6, 7.5, 'build'], [7.5, 9, 'build'], [9, 10.5, 'build'], [10.5, 12, 'build'], [12, 13.5, 'build'], [13.5, 15, 'build'], [15, 16.5, 'build'], [16.5, 18, 'build'], [18, 19.5, 'build'], [19.5, 21, 'build'], [21, 22.5, 'build'], [22.5, 24, 'build'], [24, 25, 'build'], [25, 26, 'peak'], [26, 27, 'peak'], [27, 28, 'peak'], [28, 30, 'outro']],
  },
  {
    id: 'my-day',
    name: 'My day',
    kind: 'Day in the life',
    seconds: 30,
    need: 'day-clips',
    needs: 'Clips across one day',
    beats: 60,
    slots: [[0, 1, 'hook'], [1, 2.5, 'build'], [2.5, 4, 'build'], [4, 5.5, 'build'], [5.5, 7, 'build'], [7, 8.5, 'build'], [8.5, 10, 'build'], [10, 11.5, 'build'], [11.5, 13, 'build'], [13, 14.5, 'build'], [14.5, 16, 'build'], [16, 17.5, 'build'], [17.5, 19, 'build'], [19, 20.5, 'build'], [20.5, 22, 'build'], [22, 23.5, 'build'], [23.5, 25, 'build'], [25, 26.5, 'build'], [26.5, 28, 'build'], [28, 30, 'outro']],
  },
  {
    id: 'quick-tip',
    name: 'Quick tip to camera',
    kind: 'Talking to camera',
    seconds: 30,
    need: 'talking',
    needs: 'One clip of you talking',
    beats: 50,
    slots: [[0, 1.2, 'hook'], [1.2, 4.8, 'build'], [4.8, 10.8, 'build'], [10.8, 12.6, 'build'], [12.6, 18, 'build'], [18, 19.8, 'build'], [19.8, 25.2, 'build'], [25.2, 28.2, 'build'], [28.2, 30, 'outro']],
  },
  {
    id: 'product-in-30-seconds',
    name: 'Product in 30 seconds',
    kind: 'Product ad',
    seconds: 30,
    need: 'product',
    needs: 'Clips of a product in use',
    beats: 60,
    slots: [[0, 1, 'hook'], [1, 2.5, 'build'], [2.5, 4, 'build'], [4, 5.5, 'build'], [5.5, 7, 'build'], [7, 8.5, 'build'], [8.5, 10, 'build'], [10, 11.5, 'build'], [11.5, 13, 'build'], [13, 14.5, 'build'], [14.5, 16, 'build'], [16, 17.5, 'build'], [17.5, 19, 'build'], [19, 20.5, 'build'], [20.5, 22, 'build'], [22, 23.5, 'build'], [23.5, 25, 'build'], [25, 26.5, 'build'], [26.5, 28, 'build'], [28, 30, 'build']],
  },
  {
    id: 'glow-up',
    name: 'Glow-up',
    kind: 'Before and after',
    seconds: 15,
    need: 'two-clips',
    needs: 'Two clips: before and after',
    beats: 30,
    slots: [[0, 1, 'hook'], [1, 2.5, 'build'], [2.5, 4, 'build'], [4, 5.5, 'build'], [5.5, 7, 'build'], [7, 8.5, 'build'], [8.5, 10, 'build'], [10, 11.5, 'build'], [11.5, 13, 'build'], [13, 15, 'outro']],
  },
  {
    id: 'best-moments',
    name: 'Best moments',
    kind: 'Highlight reel',
    seconds: 15,
    need: 'many-clips',
    needs: 'Lots of short clips',
    beats: 32,
    slots: [[0, 0.933, 'hook'], [0.933, 2.333, 'build'], [2.333, 3.767, 'build'], [3.767, 5.167, 'build'], [5.167, 6.567, 'build'], [6.567, 7.967, 'build'], [7.967, 8.433, 'peak'], [8.433, 8.9, 'peak'], [8.9, 9.367, 'peak'], [9.367, 11.267, 'build'], [11.267, 13.133, 'build'], [13.133, 15, 'outro']],
  },
  {
    id: 'recipe-in-30-seconds',
    name: 'Recipe in 30 seconds',
    kind: 'How-to',
    seconds: 30,
    need: 'steps',
    needs: 'A clip of each step',
    beats: 50,
    slots: [[0, 1.2, 'hook'], [1.2, 3.6, 'build'], [3.6, 7.8, 'build'], [7.8, 11.4, 'build'], [11.4, 15, 'build'], [15, 18.6, 'build'], [18.6, 22.2, 'build'], [22.2, 25.8, 'build'], [25.8, 28.2, 'build'], [28.2, 30, 'outro']],
  },
  {
    id: 'podcast-moment',
    name: 'Podcast moment',
    kind: 'Podcast clip',
    seconds: 30,
    need: 'conversation',
    needs: 'One clip of a conversation',
    beats: 50,
    slots: [[0, 1.2, 'hook'], [1.2, 6.6, 'build'], [6.6, 11.4, 'build'], [11.4, 16.2, 'build'], [16.2, 21, 'build'], [21, 25.8, 'build'], [25.8, 27, 'build'], [27, 28.2, 'build'], [28.2, 30, 'outro']],
  },];
