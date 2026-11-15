// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* eslint-disable lingui/no-unlocalized-strings -- sample model output: data, never translated */

/**
 * KEEP1: a reel whose format has a fixed part, as a template the way its breakdown left it. Three slots: the person's
 * own shot, then a film scene and a reaction clip that every video in the format keeps. The Analyst stated the last
 * two as the reel's own footage, each with its reason. Unlisted, like the review's reels (read in a chat, not saved),
 * and it keeps its reel, so the review can flip each slot. Its made video is make/p3/seeds/kept-reel.ts.
 */
import type { Template } from '@taalcut/core';
import { buildTemplate } from './template-data';
import type { TemplatePlan } from './template-plans';

export const KEPT_REEL: TemplatePlan = {
  n: 9,
  name: 'My morning, then the scene',
  platform: 'reels',
  bpm: 120,
  beatFrames: 15,
  scene: 4,
  language: 'en',
  slots: [
    {
      beats: 4,
      role: 'hook',
      text: 'Someone at their desk looks up at the camera, about to say something',
      shotType: 'medium',
      motion: 'static',
      energy: 0.45,
      people: 1,
    },
    {
      beats: 4,
      role: 'peak',
      text: 'A film scene: a man in a suit slams a door and walks off down a corridor',
      shotType: 'wide',
      motion: 'tracking',
      energy: 0.8,
      people: 1,
    },
    {
      beats: 2,
      role: 'outro',
      text: 'A reaction clip: a cat stares at the camera, unimpressed',
      shotType: 'close',
      motion: 'static',
      energy: 0.3,
    },
  ],
  overlays: [],
};

/** Why Taalcut read each kept slot as the reel's own, by slot index: its own short line. */
export const KEPT_REEL_REASONS: Readonly<Record<number, string>> = {
  1: 'A film scene the joke lands on',
  2: 'The reaction clip this format always ends on',
};

export function keptReelTemplate(): Template {
  const built = buildTemplate(KEPT_REEL);
  return {
    ...built,
    slots: built.slots.map((slot, index) => {
      const reason = KEPT_REEL_REASONS[index];
      return reason ? { ...slot, footage: { from: 'reel' as const, by: 'analyst' as const, reason } } : slot;
    }),
  };
}

/** The fake's templates that were read in a chat and not saved, beside the review's two: each with its name. */
export const keptReelTemplates = (): { readonly template: Template; readonly name: string }[] => [
  { template: keptReelTemplate(), name: KEPT_REEL.name },
];
