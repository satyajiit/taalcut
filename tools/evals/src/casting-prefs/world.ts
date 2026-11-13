// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The simulated creator's library and templates (LRN1-PREF eval), built from a seed so one seed is one world: shot
 * profiles over six places with every camera motion, faces, quality and energy spread out, and five-slot templates
 * whose slots ask for a place, a framing, a motion, a number of people and an energy. @taalcut/timeline's casting
 * engine casts them as it casts the app's; descriptions and intents are embedded with the casting eval's
 * deterministic feature-hashing embedder, never the vision model, so every number measured on it is synthetic.
 */
import {
  CAMERA_MOTIONS,
  FrameRate,
  idSchema,
  RationalTime,
  TimeRange,
  type CameraMotion,
  type Id,
  type ShotProfile,
  type Template,
} from '@taalcut/core';
import { hashText } from '../casting/library';
import { fixtureTemplate, type FixtureSlot } from '../casting/template';
import { mulberry32 } from '../gates/stats';

const PLACES = [
  { place: 'beach', words: ['beach', 'waves', 'sand', 'water'] },
  { place: 'market', words: ['market', 'stall', 'spices', 'crowd'] },
  { place: 'street', words: ['street', 'traffic', 'crossing', 'city'] },
  { place: 'cafe', words: ['cafe', 'coffee', 'cup', 'table'] },
  { place: 'mountain', words: ['mountain', 'trail', 'peak', 'clouds'] },
  { place: 'festival', words: ['festival', 'lights', 'dance', 'drums'] },
] as const;
const FRAMINGS = ['wide shot', 'close up', 'medium shot', 'detail'] as const;
const MOTION_WORDS: Readonly<Record<CameraMotion, string>> = {
  static: 'static camera',
  pan: 'slow pan',
  tilt: 'tilt up',
  'push-in': 'push in',
  'pull-out': 'pull out',
  handheld: 'handheld',
  tracking: 'tracking shot',
};
const RATE = FrameRate.of(30);
/** Shots per place. */
const PER_PLACE = 16;
const SLOTS = 5;
const ULID_DIGITS = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** A ULID made from a counter, so a world's ids are the same on every run (`kind` keeps entities apart). */
export function worldId<E extends string>(kind: number, n: number): Id<E> {
  const digits = (value: number, width: number) => {
    let out = '';
    let rest = value;
    for (let i = 0; i < width; i++) {
      out = (ULID_DIGITS[rest % 32] ?? '0') + out;
      rest = Math.floor(rest / 32);
    }
    return out;
  };
  return idSchema<E>().parse(`01J${digits(kind, 3)}${digits(n, 20)}`);
}

export interface PrefWorld {
  readonly seed: number;
  readonly profiles: readonly ShotProfile[];
  /** The `index`th template of this world: the same index is the same template. */
  template(index: number): Template;
}

type Random = () => number;
const pick = <T>(random: Random, items: readonly T[]): T => {
  const item = items[Math.floor(random() * items.length)];
  if (item === undefined) throw new Error('pick from an empty list');
  return item;
};
const between = (random: Random, low: number, high: number) =>
  Math.round((low + random() * (high - low)) * 1000) / 1000;

function profileAt(random: Random, index: number): ShotProfile {
  const place = PLACES[index % PLACES.length] ?? PLACES[0];
  const framing = pick(random, FRAMINGS);
  const motion = pick(random, CAMERA_MOTIONS);
  const faces = framing === 'detail' ? 0 : Math.floor(random() * 4);
  const words = [pick(random, place.words), pick(random, place.words)];
  const people = faces === 0 ? '' : faces === 1 ? ', one person' : ', a group of people';
  const description = `${framing} of the ${words.join(' and ')}, ${MOTION_WORDS[motion]}${people}`;
  const frames = 90 + Math.floor(random() * 150);
  const range = TimeRange.of(RationalTime.zero(RATE), RationalTime.of(frames, RATE));
  const quality = between(random, 0.35, 0.95);
  const captured = Date.UTC(2026, 4, 1) + index * 600_000;
  return {
    assetId: worldId<'Asset'>(1, index),
    shotId: worldId<'Shot'>(2, index),
    kind: 'video',
    range,
    available: range,
    orientation: 'portrait',
    quality,
    sharpness: quality,
    motionClass: motion,
    energy: between(random, 0.1, 0.95),
    faceCount: faces,
    placeClusterId: place.place,
    objectTags: [],
    capturedAt: captured,
    fileDate: captured,
    duplicateGroup: null,
    bestTake: true,
    sourceId: null,
    embedding: hashText(description),
    motionCurve: null,
    sharpnessCurve: null,
    motionPeakFrames: [],
  };
}

function templateAt(seed: number, index: number): Template {
  const random = mulberry32(seed * 7_919 + index * 104_729 + 1);
  const slots: FixtureSlot[] = Array.from({ length: SLOTS }, () => {
    const place = pick(random, PLACES);
    const framing = pick(random, FRAMINGS);
    const motion = random() < 0.2 ? null : pick(random, CAMERA_MOTIONS);
    const motionWords = motion === null ? '' : `, ${MOTION_WORDS[motion]}`;
    return {
      frames: 15 + Math.floor(random() * 30),
      intent: `${framing} of the ${pick(random, place.words)}${motionWords}`,
      motion,
      energy: between(random, 0.1, 0.9),
    };
  });
  const template = fixtureTemplate(slots);
  // How many people each slot wants: none, one, a few, or not said.
  const people = [0, 1, 2, null] as const;
  return {
    ...template,
    id: worldId<'Template'>(3, index),
    slots: template.slots.map((slot, slotIndex) => ({
      ...slot,
      id: worldId<'TemplateSlot'>(4, index * SLOTS + slotIndex),
      intent: { ...slot.intent, people: pick(random, people) },
    })),
  };
}

export function createPrefWorld(seed: number): PrefWorld {
  const random = mulberry32(seed);
  const profiles = Array.from({ length: PLACES.length * PER_PLACE }, (_, index) => profileAt(random, index));
  return { seed, profiles, template: (index) => templateAt(seed, index) };
}
