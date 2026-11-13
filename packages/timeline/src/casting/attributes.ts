// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FIX-CAST: the things a person picks a clip by, read from words: night or day, the subject facing away from the
 * camera or towards it, indoors or out, and the shot size. A slot's come from its intent (its line, place and
 * shot type); a shot's from vision's description, its objects and its shot type. An embedding blurs these (a
 * night street and a sunny street sit close together), so casting scores them apart: the same counts fully, the
 * opposite not at all, and what either side doesn't say is left out. The words are English, as the Analyst's
 * intents and vision's descriptions are.
 */
import type { ShotType } from '@taalcut/core';

export type Light = 'night' | 'day';
export type Facing = 'away' | 'toward';
export type Setting = 'indoor' | 'outdoor';

export interface Attributes {
  readonly light: Light | null;
  readonly facing: Facing | null;
  readonly setting: Setting | null;
  readonly shotType: ShotType | null;
}

/** A slot or shot that says none of them. */
export const NO_ATTRIBUTES: Attributes = { light: null, facing: null, setting: null, shotType: null };

const words = (list: readonly string[]) => new RegExp(`\\b(?:${list.join('|')})\\b`, 'i');

const NIGHT = words([
  'night',
  'nights',
  'nighttime',
  'night-time',
  'neon',
  'neon-lit',
  'after dark',
  'evening',
  'dusk',
  'twilight',
  'illuminated',
  'lit up',
  'lit-up',
  'glowing',
  'city lights',
  'dark sky',
]);
const DAY = words([
  'day',
  'daylight',
  'daytime',
  'sunlit',
  'sunlight',
  'sunny',
  'sunshine',
  'midday',
  'noon',
  'morning',
  'blue sky',
  'bright day',
  'in the sun',
]);
const AWAY = words([
  'from behind',
  'behind (?:the|a|an|them|him|her) (?:traveler|traveller|person|subject|man|woman|walker|tourist|figure|couple|them|him|her)',
  'behind them',
  'back to (?:the )?camera',
  'backs? (?:is |are )?(?:turned )?to (?:the )?camera',
  'their back',
  'his back',
  'her back',
  'rear view',
  'from the back',
  'walks? away',
  'walking away',
  'facing away',
  'looking away',
  'away from (?:the )?camera',
  'over (?:the|their|his|her) shoulder',
]);
const TOWARD = words([
  '(?<!back )to camera',
  '(?<!back )to the camera',
  'faces the camera',
  'facing the camera',
  'facing camera',
  'looks at the camera',
  'looking at the camera',
  'looks into the camera',
  'looking into the camera',
  'towards? the camera',
  'selfie',
  'talking head',
]);
const INDOOR = words([
  'indoors?',
  'inside',
  'interior',
  'room',
  'airport',
  'terminal',
  'hallway',
  'corridor',
  'kitchen',
  'office',
  'studio',
  'cafe',
  'café',
  'restaurant',
  'mall',
  'shop interior',
  'subway car',
  'train car',
]);
const OUTDOOR = words([
  'outdoors?',
  'outside',
  'street',
  'streets',
  'forest',
  'park',
  'beach',
  'garden',
  'lake',
  'river',
  'sea',
  'ocean',
  'mountains?',
  'hills?',
  'field',
  'sky',
  'skyline',
  'waterfront',
  'courtyard',
  'trail',
  'path',
  'crossing',
]);

/** One side of a pair of word lists; null when neither or both say so. */
function either<T>(text: string, a: RegExp, aValue: T, b: RegExp, bValue: T): T | null {
  const isA = a.test(text);
  const isB = b.test(text);
  return isA === isB ? null : isA ? aValue : bValue;
}

/** The attributes these words say. */
export function readAttributes(text: string, shotType: ShotType | null = null): Attributes {
  return {
    light: either(text, NIGHT, 'night', DAY, 'day'),
    facing: either(text, AWAY, 'away', TOWARD, 'toward'),
    setting: either(text, INDOOR, 'indoor', OUTDOOR, 'outdoor'),
    shotType,
  };
}

/** How much each attribute counts against the intent's line, and what a shot one size off scores. */
export interface AttributeWeights {
  readonly weights: {
    readonly light: number;
    readonly facing: number;
    readonly setting: number;
    readonly shotType: number;
  };
  readonly nextSize: number;
}

const SIZES: readonly ShotType[] = ['wide', 'medium', 'close', 'detail'];

/** 1 for the same size, `next` for the next size, 0 otherwise; null when either doesn't say. */
export function sizeMatch(slot: ShotType | null, shot: ShotType | null, next: number): number | null {
  if (!slot || !shot) return null;
  if (slot === shot) return 1;
  const a = SIZES.indexOf(slot);
  const b = SIZES.indexOf(shot);
  return a >= 0 && b >= 0 && Math.abs(a - b) === 1 ? next : 0;
}

export interface AttributeMatch {
  /** The weighted share of what both sides say that agrees, 0..1. */
  readonly score: number;
  /** The weight of what both sides say: 0 when nothing can be compared. */
  readonly weight: number;
  /** Night for day, or facing away for facing the camera: what a person would never pick for the slot. */
  readonly conflict: boolean;
}

export function attributeMatch(slot: Attributes, shot: Attributes, config: AttributeWeights): AttributeMatch {
  const { weights } = config;
  let weight = 0;
  let agreed = 0;
  let conflict = false;
  const add = (match: number | null, w: number, hard = false) => {
    if (match === null || w <= 0) return;
    weight += w;
    agreed += w * match;
    if (hard && match === 0) conflict = true;
  };
  const same = <T>(a: T | null, b: T | null) => (a === null || b === null ? null : a === b ? 1 : 0);
  add(same(slot.light, shot.light), weights.light, true);
  add(same(slot.facing, shot.facing), weights.facing, true);
  add(same(slot.setting, shot.setting), weights.setting);
  add(sizeMatch(slot.shotType, shot.shotType, config.nextSize), weights.shotType);
  return { score: weight > 0 ? agreed / weight : 0, weight, conflict };
}

/** A shot's attributes: vision's description and objects, and its shot size. */
export function shotAttributes(profile: {
  readonly description?: string | null;
  readonly objectTags: readonly string[];
  readonly shotType?: ShotType | null;
}): Attributes {
  return readAttributes(
    [profile.description ?? '', ...profile.objectTags].join('. '),
    profile.shotType ?? null,
  );
}
