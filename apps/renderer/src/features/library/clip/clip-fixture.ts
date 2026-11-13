// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* eslint-disable lingui/no-unlocalized-strings -- the skeleton's stand-in clip: shapes for the bones, never shown */

/**
 * A typical clip for the clip page's skeleton: the capture browser (`bones:capture`) renders the page with it so
 * boneyard can measure the real layout. Only its shape matters: a vertical clip of five shots with a few lines of
 * speech, fully analysed. It is never on screen for anyone.
 */
import { newId, type AssetDetail, type ShotDetail } from '@taalcut/core';

const RATE = { num: 30, den: 1 };
const at = (value: number) => ({ value, rate: RATE });
const assetId = newId<'Asset'>();
const sourceId = newId<'Source'>();

const SHOT_FRAMES = [0, 120, 330, 450, 600, 870];

const shots: ShotDetail[] = SHOT_FRAMES.slice(0, -1).map((start, index) => ({
  id: newId<'Shot'>(),
  assetId,
  index,
  range: { start: at(start), duration: at((SHOT_FRAMES[index + 1] ?? start) - start) },
  description: 'A street at night with shop signs and scooters passing by',
  shotType: 'medium',
  motion: 'pan',
  quality: 0.7,
  bestTake: true,
  thumbnail: null,
  analysis: null,
  transcriptText: null,
  duplicateGroup: null,
}));

const lines = [0, 240, 450, 660].map((start) => ({
  text: 'This market is incredible, there is a bit of everything here.',
  range: { start: at(start), duration: at(180) },
}));

const steps = ['library.hash', 'media.normalise', 'vision.shots', 'vision.analyse', 'audio.transcript'];

export const CLIP_FIXTURE: AssetDetail = {
  asset: {
    id: assetId,
    kind: 'video',
    name: 'IMG_0000.MOV',
    capturedAt: 0,
    addedAt: 0,
    duration: at(870),
    width: 1080,
    height: 1920,
    orientation: 'portrait',
    availability: 'online',
    sourceIds: [sourceId],
    description: 'A busy street at night with neon shop signs and scooters passing',
    quality: 0.7,
    shotCount: shots.length,
    language: 'en',
    index: { state: 'done', done: steps.length, total: steps.length, searchableAt: 0 },
    thumbnail: null,
    reencode: null,
    trashed: false,
    provenance: { kind: 'captured' },
  },
  facts: {
    version: 1,
    width: 1080,
    height: 1920,
    orientation: 'portrait',
    duration: at(870),
    frameRate: RATE,
    variableFrameRate: false,
    hdr: 'none',
    speed: 'normal',
    speedFactor: 1,
    retimedInFile: false,
    hasAudio: true,
    device: { make: 'Apple', model: 'iPhone' },
  },
  shots,
  transcript: { language: 'en', lines, truncated: false },
  locations: [
    {
      id: newId<'AssetLocation'>(),
      sourceId,
      sourceName: 'iPhone',
      storage: 'managed',
      state: 'present',
      relativePath: 'IMG_0000.MOV',
      volumeName: null,
    },
  ],
  reencodeReasons: [],
  stages: steps.map((stage) => ({ stage, state: 'done' })),
  playback: null,
  filmstrip: null,
  waveform: null,
  beats: null,
  sizeBytes: 48_000_000,
};
