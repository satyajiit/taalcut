// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Stand-in content for the skeleton capture of the hub's list and a hub template's page: the capture browser has
 * no hub to read, so these give the bones their real shape. Shown to nobody.
 */
import {
  HUB_FORMAT,
  HUB_FORMAT_VERSION,
  type HubBrowseItem,
  type HubStructure,
  type HubTemplateDetail,
  type HubTemplateId,
} from '@taalcut/core';

const FPS = { num: 30, den: 1 } as const;
const MS = { num: 1000, den: 1 } as const;
const at = (frames: number) => ({ value: frames, rate: FPS });
const hubId = (n: number) => `01K7C5M6Q8HC00000000000${String(n).padStart(3, '0')}` as HubTemplateId;
const NOW = Date.UTC(2026, 9, 12);

/* Capture stand-in words, never shown to anyone: not for the catalogue. */
/* eslint-disable lingui/no-unlocalized-strings */
const NAMES = [
  'Wedding first look',
  'Street food crawl',
  'Puppy first day',
  'Cooking with grandma',
  'Tea ceremony',
];
const HANDLES = ['veil.and.vow', 'ana_edita', 'paws.patrol', 'nani.kitchen', 'slow.steep'];
const SLOT_WORDS = [
  'POV over the counter',
  'Macro of the label',
  'Medium shot, walking into frame',
  'Waist-up, looking at the camera',
  'Tight on the cup as it is poured',
  'Looking down at your feet as you go',
];
/* eslint-enable lingui/no-unlocalized-strings */
const STRIP = [36, 33, 36, 51, 33, 36] as const;

function item(index: number): HubBrowseItem {
  const strip = STRIP.slice(0, 3 + (index % 4));
  return {
    id: hubId(index + 1),
    version: 1,
    name: NAMES[index] ?? NAMES[0] ?? '',
    description: '',
    handle: HANDLES[index] ?? HANDLES[0] ?? '',
    language: 'en',
    tags: [],
    formatId: 'vlog',
    trendFreshness: '2026-10-07',
    forkedFrom: null,
    duration: at(strip.reduce((sum, each) => sum + each, 0)),
    slotCount: strip.length,
    bpm: 104,
    slotStrip: [...strip],
    sha256: 'e'.repeat(64),
    createdAt: NOW,
    updatedAt: NOW,
    rating: { count: 40 + index, mean: 4.8 - index / 10 },
    forkedAs: null,
  };
}

/** A page of the hub's list. */
export const CAPTURE_HUB_ITEMS: readonly HubBrowseItem[] = [0, 1, 2, 3, 4].map(item);

function structure(): HubStructure {
  let start = 0;
  const slots = STRIP.map((frames, index) => {
    const slot: HubStructure['slots'][number] = {
      role: index === 0 ? 'hook' : index === STRIP.length - 1 ? 'outro' : 'body',
      name: null,
      start: at(start),
      duration: at(frames),
      intent: {
        text: SLOT_WORDS[index] ?? '',
        shotType: index % 2 === 0 ? 'pov' : 'detail',
        motion: 'static',
        subject: null,
        people: null,
        place: null,
        energy: 0.5,
      },
      beatAnchor: { beatIndex: index * 2, offset: at(0) },
      transitionIn: null,
      speedRamp: null,
    };
    start += frames;
    return slot;
  });
  return {
    canvas: { width: 1080, height: 1920, rate: FPS },
    duration: at(start),
    slots,
    beatMap: {
      rate: MS,
      beats: Array.from({ length: 12 }, (_, i) => ({ value: i * 577, rate: MS })),
      downbeats: [0, 4, 8],
      bpm: 104,
      beatsPerBar: 4,
      confidence: 0.9,
      source: 'tracker',
    },
    text: [],
    audio: { kind: 'music', loudnessLufs: -9, speechCoverage: null, speechLanguage: null },
    pacing: {
      shotCount: slots.length,
      meanShot: at(37),
      medianShot: at(36),
      shortestShot: at(33),
      longestShot: at(51),
      hookEnd: at(36),
      cutsOnBeat: 1,
    },
  };
}

const FIRST = item(0);

/** A hub template's page: six slots, its facts and the licence line. */
export const CAPTURE_HUB_DETAIL: HubTemplateDetail = {
  item: { ...FIRST, description: SLOT_WORDS[0] ?? '', tags: ['cafe', 'morning'] },
  document: {
    format: HUB_FORMAT,
    formatVersion: HUB_FORMAT_VERSION,
    // eslint-disable-next-line lingui/no-unlocalized-strings -- the licence's SPDX id, not words
    licence: 'CC0-1.0',
    id: FIRST.id,
    version: 1,
    name: FIRST.name,
    description: SLOT_WORDS[0] ?? '',
    handle: FIRST.handle,
    language: 'en',
    tags: ['cafe', 'morning'],
    formatId: 'vlog',
    trendFreshness: '2026-10-07',
    forkedFrom: null,
    structure: structure(),
    style: null,
  },
  myRating: null,
};
